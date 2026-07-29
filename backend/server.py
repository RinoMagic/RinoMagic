import os
import uuid
import logging
import string
import random
import asyncio
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from zoneinfo import ZoneInfo

import httpx
import jwt
from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field

from seed_data import PLAYERS, TEAMS

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# --- Config ---
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_MINUTES = int(os.environ.get("ACCESS_TOKEN_MINUTES", "10080"))
ADMIN_EMAIL = os.environ["ADMIN_EMAIL"]
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]
API_FOOTBALL_KEY = os.environ.get("API_FOOTBALL_KEY", "").strip()
API_FOOTBALL_BASE = os.environ.get("API_FOOTBALL_BASE", "https://v3.football.api-sports.io").rstrip("/")
SERIE_A_LEAGUE_ID = int(os.environ.get("SERIE_A_LEAGUE_ID", "135"))
CURRENT_SEASON = int(os.environ.get("CURRENT_SEASON", "2024"))
SCHEDULER_ENABLED = os.environ.get("SCHEDULER_ENABLED", "true").lower() == "true"
SCHEDULER_INTERVAL_SECS = int(os.environ.get("SCHEDULER_INTERVAL_SECS", "300"))  # 5 min
SCHEDULER_MIN_GAP_SECS = int(os.environ.get("SCHEDULER_MIN_GAP_SECS", "1800"))  # 30 min

# Serie A match windows in Europe/Rome local time (weekday: [(start_hhmm, end_hhmm), ...])
# Monday=0 ... Sunday=6
MATCH_WINDOWS: dict[int, list[tuple[str, str]]] = {
    0: [("20:00", "23:30")],   # Monday
    4: [("20:00", "23:30")],   # Friday
    5: [("14:30", "23:30")],   # Saturday
    6: [("12:00", "23:30")],   # Sunday
}
ROME_TZ = ZoneInfo("Europe/Rome")

# --- DB ---
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# --- App ---
app = FastAPI(title="FantaGiornata API")
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
DUMMY_HASH = pwd_context.hash("dummy-password-for-timing")

logger = logging.getLogger("fantagiornata")
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")


# ============ Models ============
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    username: str = Field(min_length=2, max_length=24)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: str
    email: EmailStr
    username: str


class Player(BaseModel):
    id: str
    name: str
    team: str
    role: str  # P D C A


class LeagueCreate(BaseModel):
    name: str = Field(min_length=2, max_length=40)


class LeagueJoin(BaseModel):
    code: str


class League(BaseModel):
    id: str
    name: str
    code: str
    owner_id: str
    created_at: datetime
    members_count: int = 0
    is_owner: bool = False
    current_matchday: int = 1


class MatchdayCreate(BaseModel):
    number: int = Field(ge=1, le=38)


class LineupIn(BaseModel):
    matchday: int
    module: str  # e.g. "4-3-3"
    starters: List[str]  # 11 player ids
    bench: List[str] = []  # 8 bench: 2P + 2D + 2C + 2A


class VoteIn(BaseModel):
    player_id: str
    voto: float = 6.0
    gol: int = 0
    assist: int = 0
    ammoniz: bool = False
    espuls: bool = False
    autogol: int = 0
    gol_subiti: int = 0  # for portiere
    rigore_segnato: int = 0
    rigore_sbagliato: int = 0
    rigore_parato: int = 0  # for portiere
    gol_vittoria: int = 0  # winning goal bonus
    gol_pareggio: int = 0  # tying goal bonus


class VotesSubmit(BaseModel):
    matchday: int
    votes: List[VoteIn]


# ============ Helpers ============
def hash_password(p: str) -> str:
    return pwd_context.hash(p)


def verify_password(p: str, h: str) -> bool:
    return pwd_context.verify(p, h)


def create_token(user_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MINUTES)
    return jwt.encode({"sub": user_id, "exp": exp}, JWT_SECRET, algorithm=JWT_ALGORITHM)


def gen_code(n: int = 6) -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=n))


def fantavoto_from_vote(v: dict, role: str) -> float:
    """Compute fantavoto with bonus/malus."""
    fv = float(v.get("voto", 6.0))
    fv += 3 * v.get("gol", 0)
    fv += 1 * v.get("assist", 0)
    fv += 3 * v.get("rigore_segnato", 0)
    fv -= 3 * v.get("rigore_sbagliato", 0)
    fv -= 0.5 if v.get("ammoniz") else 0
    fv -= 1 if v.get("espuls") else 0
    fv -= 2 * v.get("autogol", 0)
    fv += 1 * v.get("gol_vittoria", 0)
    fv += 0.5 * v.get("gol_pareggio", 0)
    if role == "P":
        # portiere: -1 per ogni gol subito, +3 per rigore parato
        fv -= 1 * v.get("gol_subiti", 0)
        fv += 3 * v.get("rigore_parato", 0)
    return round(fv, 2)


async def get_current_user(cred: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> dict:
    if not cred:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(cred.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def require_system_admin(user: dict = Depends(get_current_user)) -> dict:
    """Only the seeded admin (by ADMIN_EMAIL) can call system-wide endpoints."""
    if user.get("email") != ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Solo l'admin di sistema puo eseguire questa azione")
    return user


# ============ Startup ============
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.players.create_index("id", unique=True)
    await db.leagues.create_index("id", unique=True)
    await db.leagues.create_index("code", unique=True)
    await db.memberships.create_index([("league_id", 1), ("user_id", 1)], unique=True)
    await db.lineups.create_index([("league_id", 1), ("user_id", 1), ("matchday", 1)], unique=True)
    await db.votes.create_index([("league_id", 1), ("matchday", 1), ("player_id", 1)], unique=True)
    await db.api_votes.create_index([("matchday", 1), ("player_id", 1)], unique=True)
    await db.system.create_index("key", unique=True)

    # Init system defaults
    await db.system.update_one(
        {"key": "current_matchday"},
        {"$setOnInsert": {"key": "current_matchday", "value": 1}},
        upsert=True,
    )
    await db.system.update_one(
        {"key": "scheduler_enabled"},
        {"$setOnInsert": {"key": "scheduler_enabled", "value": SCHEDULER_ENABLED}},
        upsert=True,
    )

    # Seed admin
    existing_admin = await db.users.find_one({"email": ADMIN_EMAIL})
    if not existing_admin:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": ADMIN_EMAIL,
            "username": "admin",
            "password_hash": hash_password(ADMIN_PASSWORD),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Admin user seeded")

    # Seed players idempotently
    count = await db.players.count_documents({})
    if count == 0:
        docs = []
        for name, team, role in PLAYERS:
            docs.append({
                "id": str(uuid.uuid4()),
                "name": name,
                "team": team,
                "role": role,
            })
        if docs:
            await db.players.insert_many(docs)
            logger.info(f"Seeded {len(docs)} Serie A players")

    # Start background scheduler if enabled and API key present
    if SCHEDULER_ENABLED and API_FOOTBALL_KEY:
        asyncio.create_task(_scheduler_loop())
        logger.info("Scheduler started (interval=%ss, min-gap=%ss)",
                    SCHEDULER_INTERVAL_SECS, SCHEDULER_MIN_GAP_SECS)


@app.on_event("shutdown")
async def shutdown():
    client.close()


# ============ Auth ============
@api.post("/auth/register", response_model=TokenOut, status_code=201)
async def register(data: RegisterIn):
    existing = await db.users.find_one({"email": data.email})
    if existing:
        raise HTTPException(status_code=409, detail="Email gia registrata")
    user_id = str(uuid.uuid4())
    await db.users.insert_one({
        "id": user_id,
        "email": data.email,
        "username": data.username,
        "password_hash": hash_password(data.password),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return TokenOut(access_token=create_token(user_id))


@api.post("/auth/login", response_model=TokenOut)
async def login(data: LoginIn):
    user = await db.users.find_one({"email": data.email})
    if not user:
        verify_password(data.password, DUMMY_HASH)
        raise HTTPException(status_code=401, detail="Credenziali non valide")
    if not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenziali non valide")
    return TokenOut(access_token=create_token(user["id"]))


@api.get("/auth/me", response_model=UserOut)
async def me(user: dict = Depends(get_current_user)):
    return UserOut(id=user["id"], email=user["email"], username=user["username"])


# ============ Players ============
@api.get("/players", response_model=List[Player])
async def list_players(
    role: Optional[str] = None,
    team: Optional[str] = None,
    q: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    query = {}
    if role and role in ("P", "D", "C", "A"):
        query["role"] = role
    if team:
        query["team"] = team
    if q:
        query["name"] = {"$regex": q, "$options": "i"}
    cursor = db.players.find(query, {"_id": 0}).limit(500)
    return [Player(**p) async for p in cursor]


@api.get("/teams", response_model=List[str])
async def list_teams(user: dict = Depends(get_current_user)):
    teams_from_db = await db.players.distinct("team")
    if teams_from_db:
        return sorted(teams_from_db)
    return TEAMS


# ============ API-Football sync ============
POSITION_MAP = {
    "Goalkeeper": "P",
    "Defender": "D",
    "Midfielder": "C",
    "Attacker": "A",
}


async def _apifootball_get(client: httpx.AsyncClient, path: str, params: dict) -> dict:
    if not API_FOOTBALL_KEY:
        raise HTTPException(status_code=400, detail="API_FOOTBALL_KEY non configurata")
    headers = {"x-apisports-key": API_FOOTBALL_KEY}
    try:
        r = await client.get(f"{API_FOOTBALL_BASE}{path}", params=params, headers=headers, timeout=20.0)
        r.raise_for_status()
        data = r.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=400, detail=f"API-Football: HTTP {e.response.status_code}")
    except httpx.HTTPError as e:
        raise HTTPException(status_code=400, detail=f"API-Football: connessione fallita ({type(e).__name__})")
    errors = data.get("errors")
    if errors:
        # api-football returns errors as dict or list
        if isinstance(errors, dict) and errors:
            msg = next(iter(errors.values()))
            raise HTTPException(status_code=400, detail=f"API-Football: {msg}")
        if isinstance(errors, list) and errors:
            raise HTTPException(status_code=400, detail=f"API-Football: {errors[0]}")
    return data


# ============ Global API votes cache + scheduler ============
async def _system_get(key: str, default=None):
    doc = await db.system.find_one({"key": key}, {"_id": 0})
    return doc["value"] if doc else default


async def _system_set(key: str, value) -> None:
    await db.system.update_one(
        {"key": key}, {"$set": {"key": key, "value": value}}, upsert=True
    )


def _in_match_window(dt_local: datetime) -> bool:
    """Return True if the given Europe/Rome datetime is inside a Serie A match window."""
    windows = MATCH_WINDOWS.get(dt_local.weekday(), [])
    for start_str, end_str in windows:
        sh, sm = (int(x) for x in start_str.split(":"))
        eh, em = (int(x) for x in end_str.split(":"))
        start = dt_local.replace(hour=sh, minute=sm, second=0, microsecond=0)
        end = dt_local.replace(hour=eh, minute=em, second=0, microsecond=0)
        if start <= dt_local <= end:
            return True
    return False


async def _sync_matchday_votes_global(matchday: int, season: int) -> int:
    """Fetch fixtures + player stats for a Serie A matchday and upsert into api_votes (global).

    Returns number of votes upserted. Raises HTTPException on API error.
    """
    if not API_FOOTBALL_KEY:
        raise HTTPException(status_code=400, detail="API_FOOTBALL_KEY non configurata")

    # Build external_id -> local id map
    ext_to_local: dict[str, str] = {}
    async for p in db.players.find({"external_id": {"$exists": True, "$ne": None}}, {"_id": 0}):
        if p.get("external_id"):
            ext_to_local[str(p["external_id"])] = p["id"]
    if not ext_to_local:
        raise HTTPException(
            status_code=400,
            detail="La rosa non e sincronizzata dall'API. Sincronizza prima la rosa dalla tab Rosa.",
        )

    collected = 0
    async with httpx.AsyncClient() as http_client:
        fixtures_data = await _apifootball_get(
            http_client,
            "/fixtures",
            {"league": SERIE_A_LEAGUE_ID, "season": season, "round": f"Regular Season - {matchday}"},
        )
        fixtures = fixtures_data.get("response", [])
        if not fixtures:
            raise HTTPException(status_code=400, detail=f"Nessuna partita trovata per giornata {matchday}")

        for f in fixtures:
            fixture_id = f.get("fixture", {}).get("id")
            if not fixture_id:
                continue
            try:
                stats_data = await _apifootball_get(
                    http_client, "/fixtures/players", {"fixture": fixture_id}
                )
            except HTTPException as e:
                logger.warning(f"Failed stats for fixture {fixture_id}: {e.detail}")
                continue
            for team_stats in stats_data.get("response", []):
                for pdata in team_stats.get("players", []):
                    ext_pid = str(pdata.get("player", {}).get("id"))
                    local_id = ext_to_local.get(ext_pid)
                    if not local_id:
                        continue
                    stats = (pdata.get("statistics") or [{}])[0]
                    rating_str = stats.get("games", {}).get("rating")
                    if rating_str is None:
                        continue
                    try:
                        voto = float(rating_str)
                    except (TypeError, ValueError):
                        continue
                    goals = stats.get("goals", {}) or {}
                    cards = stats.get("cards", {}) or {}
                    penalty = stats.get("penalty", {}) or {}
                    passes = stats.get("passes", {}) or {}
                    vote_dict = {
                        "voto": voto,
                        "gol": int(goals.get("total") or 0),
                        "assist": int(passes.get("assists") or goals.get("assists") or 0),
                        "ammoniz": bool(cards.get("yellow")),
                        "espuls": bool(cards.get("red")),
                        "autogol": 0,
                        "gol_subiti": int(goals.get("conceded") or 0),
                        "rigore_segnato": int(penalty.get("scored") or 0),
                        "rigore_sbagliato": int(penalty.get("missed") or 0),
                        "rigore_parato": int(penalty.get("saved") or 0),
                        "gol_vittoria": 0,
                        "gol_pareggio": 0,
                    }
                    player_doc = await db.players.find_one({"id": local_id}, {"_id": 0})
                    role = player_doc.get("role") if player_doc else "C"
                    fv = fantavoto_from_vote(vote_dict, role)
                    await db.api_votes.update_one(
                        {"matchday": matchday, "player_id": local_id},
                        {"$set": {
                            "matchday": matchday,
                            "player_id": local_id,
                            **vote_dict,
                            "fantavoto": fv,
                            "season": season,
                            "source": "api-football",
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        }},
                        upsert=True,
                    )
                    collected += 1
            await asyncio.sleep(0.1)
    return collected


async def _scheduler_loop() -> None:
    """Background loop: every SCHEDULER_INTERVAL_SECS check whether we should sync votes."""
    logger.info("Scheduler loop running")
    while True:
        try:
            await asyncio.sleep(SCHEDULER_INTERVAL_SECS)
            enabled = await _system_get("scheduler_enabled", True)
            if not enabled:
                continue
            now_local = datetime.now(ROME_TZ)
            if not _in_match_window(now_local):
                continue
            last_at_iso = await _system_get("last_scheduled_sync_at")
            if last_at_iso:
                try:
                    last_at = datetime.fromisoformat(last_at_iso)
                    if (datetime.now(timezone.utc) - last_at).total_seconds() < SCHEDULER_MIN_GAP_SECS:
                        continue
                except ValueError:
                    pass
            matchday = int(await _system_get("current_matchday", 1))
            season = int(await _system_get("current_season", CURRENT_SEASON))
            try:
                count = await _sync_matchday_votes_global(matchday, season)
                await _system_set("last_scheduled_sync_at", datetime.now(timezone.utc).isoformat())
                await _system_set("last_scheduled_sync_count", count)
                await _system_set("last_scheduled_sync_error", None)
                logger.info("Scheduled sync ok: matchday=%s votes=%s", matchday, count)
            except HTTPException as e:
                await _system_set("last_scheduled_sync_error", str(e.detail))
                logger.warning("Scheduled sync failed: %s", e.detail)
            except Exception as e:
                await _system_set("last_scheduled_sync_error", f"{type(e).__name__}: {e}")
                logger.exception("Scheduler tick error")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Unhandled scheduler error")


@api.post("/players/sync")
async def sync_players(
    season: Optional[int] = None,
    dry_run: bool = False,
    user: dict = Depends(get_current_user),
):
    """Sync Serie A players from API-Football into MongoDB.

    Any authenticated user can trigger sync (idempotent replace).
    Uses `season` query param, or CURRENT_SEASON from env.
    """
    if not API_FOOTBALL_KEY:
        raise HTTPException(status_code=400, detail="API key non configurata")
    target_season = season or CURRENT_SEASON

    async with httpx.AsyncClient() as http_client:
        # 1) Get all Serie A teams for the season
        teams_data = await _apifootball_get(
            http_client, "/teams", {"league": SERIE_A_LEAGUE_ID, "season": target_season}
        )
        teams = teams_data.get("response", [])
        if not teams:
            raise HTTPException(status_code=400, detail="Nessuna squadra ricevuta dall'API")

        collected: list[dict] = []
        team_names: list[str] = []

        # 2) For each team get the squad
        for t in teams:
            team_info = t.get("team", {})
            team_id = team_info.get("id")
            team_name = team_info.get("name") or "Unknown"
            team_names.append(team_name)
            if not team_id:
                continue
            try:
                squad_data = await _apifootball_get(
                    http_client, "/players/squads", {"team": team_id}
                )
            except HTTPException as e:
                logger.warning(f"Failed squad for {team_name}: {e.detail}")
                continue
            resp = squad_data.get("response", [])
            if not resp:
                continue
            players_list = resp[0].get("players", [])
            for p in players_list:
                pos = p.get("position") or ""
                role = POSITION_MAP.get(pos)
                if not role:
                    continue
                collected.append({
                    "external_id": str(p.get("id")),
                    "name": p.get("name") or "?",
                    "team": team_name,
                    "role": role,
                    "photo": p.get("photo"),
                    "number": p.get("number"),
                    "age": p.get("age"),
                    "source": "api-football",
                    "season": target_season,
                })
            # small delay to be nice
            await asyncio.sleep(0.15)

    if dry_run:
        return {
            "dry_run": True,
            "season": target_season,
            "teams_found": len(team_names),
            "players_ready": len(collected),
        }

    # 3) Replace players collection atomically-ish:
    # Preserve stability of ids: match by external_id if present, else regenerate
    existing = {}
    async for doc in db.players.find({}, {"_id": 0}):
        ext = doc.get("external_id")
        if ext:
            existing[ext] = doc.get("id")

    docs_to_insert = []
    for c in collected:
        pid = existing.get(c["external_id"]) or str(uuid.uuid4())
        docs_to_insert.append({"id": pid, **c})

    # Drop and reinsert
    await db.players.delete_many({})
    if docs_to_insert:
        await db.players.insert_many(docs_to_insert)

    return {
        "ok": True,
        "season": target_season,
        "teams": len(team_names),
        "players_synced": len(docs_to_insert),
    }


@api.get("/players/sync/status")
async def sync_status(user: dict = Depends(get_current_user)):
    total = await db.players.count_documents({})
    api_synced = await db.players.count_documents({"source": "api-football"})
    seasons = sorted(await db.players.distinct("season") or [])
    return {
        "total": total,
        "api_synced": api_synced,
        "seasons": seasons,
        "api_key_configured": bool(API_FOOTBALL_KEY),
        "current_season_env": CURRENT_SEASON,
    }


# ============ Leagues ============
async def _league_public(league: dict, user_id: str) -> dict:
    members_count = await db.memberships.count_documents({"league_id": league["id"]})
    return {
        "id": league["id"],
        "name": league["name"],
        "code": league["code"],
        "owner_id": league["owner_id"],
        "created_at": league["created_at"],
        "members_count": members_count,
        "is_owner": league["owner_id"] == user_id,
        "current_matchday": league.get("current_matchday", 1),
    }


@api.post("/leagues", response_model=League)
async def create_league(data: LeagueCreate, user: dict = Depends(get_current_user)):
    # Generate unique code
    for _ in range(10):
        code = gen_code()
        if not await db.leagues.find_one({"code": code}):
            break
    league_id = str(uuid.uuid4())
    doc = {
        "id": league_id,
        "name": data.name,
        "code": code,
        "owner_id": user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "current_matchday": 1,
    }
    await db.leagues.insert_one(doc)
    await db.memberships.insert_one({
        "league_id": league_id,
        "user_id": user["id"],
        "joined_at": datetime.now(timezone.utc).isoformat(),
    })
    return League(**await _league_public(doc, user["id"]))


@api.post("/leagues/join", response_model=League)
async def join_league(data: LeagueJoin, user: dict = Depends(get_current_user)):
    league = await db.leagues.find_one({"code": data.code.upper()}, {"_id": 0})
    if not league:
        raise HTTPException(status_code=404, detail="Codice lega non trovato")
    existing = await db.memberships.find_one({"league_id": league["id"], "user_id": user["id"]})
    if not existing:
        await db.memberships.insert_one({
            "league_id": league["id"],
            "user_id": user["id"],
            "joined_at": datetime.now(timezone.utc).isoformat(),
        })
    return League(**await _league_public(league, user["id"]))


@api.get("/leagues", response_model=List[League])
async def list_leagues(user: dict = Depends(get_current_user)):
    memberships = db.memberships.find({"user_id": user["id"]}, {"_id": 0})
    league_ids = [m["league_id"] async for m in memberships]
    if not league_ids:
        return []
    cursor = db.leagues.find({"id": {"$in": league_ids}}, {"_id": 0})
    out = []
    async for lg in cursor:
        out.append(League(**await _league_public(lg, user["id"])))
    return out


@api.get("/leagues/{league_id}", response_model=League)
async def get_league(league_id: str, user: dict = Depends(get_current_user)):
    league = await db.leagues.find_one({"id": league_id}, {"_id": 0})
    if not league:
        raise HTTPException(status_code=404, detail="Lega non trovata")
    member = await db.memberships.find_one({"league_id": league_id, "user_id": user["id"]})
    if not member:
        raise HTTPException(status_code=403, detail="Non sei membro di questa lega")
    return League(**await _league_public(league, user["id"]))


@api.get("/leagues/{league_id}/members")
async def league_members(league_id: str, user: dict = Depends(get_current_user)):
    member = await db.memberships.find_one({"league_id": league_id, "user_id": user["id"]})
    if not member:
        raise HTTPException(status_code=403, detail="Accesso negato")
    cursor = db.memberships.find({"league_id": league_id}, {"_id": 0})
    users_ids = [m["user_id"] async for m in cursor]
    users = db.users.find({"id": {"$in": users_ids}}, {"_id": 0, "password_hash": 0})
    return [{"id": u["id"], "username": u["username"]} async for u in users]


@api.post("/leagues/{league_id}/advance", response_model=League)
async def advance_matchday(league_id: str, user: dict = Depends(get_current_user)):
    league = await db.leagues.find_one({"id": league_id}, {"_id": 0})
    if not league:
        raise HTTPException(status_code=404, detail="Lega non trovata")
    if league["owner_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Solo il proprietario puo avanzare la giornata")
    new_md = league.get("current_matchday", 1) + 1
    await db.leagues.update_one({"id": league_id}, {"$set": {"current_matchday": new_md}})
    league["current_matchday"] = new_md
    return League(**await _league_public(league, user["id"]))


# ============ Lineups ============
@api.post("/leagues/{league_id}/lineups")
async def submit_lineup(league_id: str, data: LineupIn, user: dict = Depends(get_current_user)):
    league = await db.leagues.find_one({"id": league_id}, {"_id": 0})
    if not league:
        raise HTTPException(status_code=404, detail="Lega non trovata")
    member = await db.memberships.find_one({"league_id": league_id, "user_id": user["id"]})
    if not member:
        raise HTTPException(status_code=403, detail="Non membro")
    if len(data.starters) != 11:
        raise HTTPException(status_code=400, detail="Devi selezionare esattamente 11 titolari")
    if len(set(data.starters)) != 11:
        raise HTTPException(status_code=400, detail="Titolari duplicati")

    # Validate starter player ids exist
    count = await db.players.count_documents({"id": {"$in": data.starters}})
    if count != 11:
        raise HTTPException(status_code=400, detail="Alcuni titolari non esistono")

    # Bench validation: allow empty (backward compat) OR exactly 8 with 2P+2D+2C+2A composition
    if data.bench:
        if len(data.bench) != 8:
            raise HTTPException(status_code=400, detail="La panchina deve avere 8 giocatori (2P + 2D + 2C + 2A)")
        if len(set(data.bench)) != 8:
            raise HTTPException(status_code=400, detail="Panchina: giocatori duplicati")
        # No overlap between starters and bench
        if set(data.bench) & set(data.starters):
            raise HTTPException(status_code=400, detail="Un giocatore non puo essere sia titolare che panchina")
        bench_docs = [p async for p in db.players.find({"id": {"$in": data.bench}}, {"_id": 0})]
        if len(bench_docs) != 8:
            raise HTTPException(status_code=400, detail="Alcuni giocatori di panchina non esistono")
        counts = {"P": 0, "D": 0, "C": 0, "A": 0}
        for p in bench_docs:
            counts[p["role"]] = counts.get(p["role"], 0) + 1
        if counts != {"P": 2, "D": 2, "C": 2, "A": 2}:
            raise HTTPException(
                status_code=400,
                detail=f"Composizione panchina errata: servono 2P+2D+2C+2A, ricevuto {counts}",
            )

    await db.lineups.update_one(
        {"league_id": league_id, "user_id": user["id"], "matchday": data.matchday},
        {"$set": {
            "league_id": league_id,
            "user_id": user["id"],
            "matchday": data.matchday,
            "module": data.module,
            "starters": data.starters,
            "bench": data.bench,
            "submitted_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return {"ok": True}


@api.get("/leagues/{league_id}/lineups/{matchday}")
async def get_my_lineup(league_id: str, matchday: int, user: dict = Depends(get_current_user)):
    lineup = await db.lineups.find_one(
        {"league_id": league_id, "user_id": user["id"], "matchday": matchday},
        {"_id": 0},
    )
    return lineup or {"empty": True}


# ============ Votes / Results ============
@api.post("/leagues/{league_id}/votes")
async def submit_votes(league_id: str, data: VotesSubmit, user: dict = Depends(get_current_user)):
    league = await db.leagues.find_one({"id": league_id}, {"_id": 0})
    if not league:
        raise HTTPException(status_code=404, detail="Lega non trovata")
    if league["owner_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Solo il proprietario puo inserire i voti")

    for v in data.votes:
        player = await db.players.find_one({"id": v.player_id}, {"_id": 0})
        if not player:
            continue
        vd = v.model_dump()
        fv = fantavoto_from_vote(vd, player["role"])
        await db.votes.update_one(
            {"league_id": league_id, "matchday": data.matchday, "player_id": v.player_id},
            {"$set": {
                "league_id": league_id,
                "matchday": data.matchday,
                "player_id": v.player_id,
                "voto": vd["voto"],
                "gol": vd["gol"],
                "assist": vd["assist"],
                "ammoniz": vd["ammoniz"],
                "espuls": vd["espuls"],
                "autogol": vd["autogol"],
                "gol_subiti": vd["gol_subiti"],
                "rigore_segnato": vd["rigore_segnato"],
                "rigore_sbagliato": vd["rigore_sbagliato"],
                "rigore_parato": vd["rigore_parato"],
                "gol_vittoria": vd["gol_vittoria"],
                "gol_pareggio": vd["gol_pareggio"],
                "fantavoto": fv,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
    return {"ok": True, "count": len(data.votes)}


@api.get("/leagues/{league_id}/votes/{matchday}")
async def get_votes(league_id: str, matchday: int, user: dict = Depends(get_current_user)):
    member = await db.memberships.find_one({"league_id": league_id, "user_id": user["id"]})
    if not member:
        raise HTTPException(status_code=403, detail="Accesso negato")
    cursor = db.votes.find({"league_id": league_id, "matchday": matchday}, {"_id": 0})
    return [v async for v in cursor]


@api.post("/leagues/{league_id}/votes/sync/{matchday}")
async def sync_votes_from_api(
    league_id: str,
    matchday: int,
    season: Optional[int] = None,
    user: dict = Depends(get_current_user),
):
    """Auto-fetch player statistics from API-Football for a matchday and compute fantavoto.

    Only lega owner can trigger. Uses api-football fixtures + fixtures/players endpoints.
    """
    league = await db.leagues.find_one({"id": league_id}, {"_id": 0})
    if not league:
        raise HTTPException(status_code=404, detail="Lega non trovata")
    if league["owner_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Solo il proprietario puo sincronizzare i voti")
    if not API_FOOTBALL_KEY:
        raise HTTPException(status_code=400, detail="API_FOOTBALL_KEY non configurata")

    target_season = season or CURRENT_SEASON

    # Build external_id → local player id map
    ext_to_local: dict[str, str] = {}
    async for p in db.players.find({"external_id": {"$exists": True}}, {"_id": 0}):
        if p.get("external_id"):
            ext_to_local[str(p["external_id"])] = p["id"]

    if not ext_to_local:
        raise HTTPException(
            status_code=400,
            detail="La rosa non e sincronizzata dall'API. Sincronizza prima la rosa dalla tab Rosa.",
        )

    async with httpx.AsyncClient() as http_client:
        # 1) Get fixtures for the matchday
        fixtures_data = await _apifootball_get(
            http_client,
            "/fixtures",
            {"league": SERIE_A_LEAGUE_ID, "season": target_season, "round": f"Regular Season - {matchday}"},
        )
        fixtures = fixtures_data.get("response", [])
        if not fixtures:
            raise HTTPException(status_code=400, detail=f"Nessuna partita trovata per giornata {matchday}")

        collected_votes = 0
        for f in fixtures:
            fixture_id = f.get("fixture", {}).get("id")
            if not fixture_id:
                continue
            try:
                stats_data = await _apifootball_get(
                    http_client, "/fixtures/players", {"fixture": fixture_id}
                )
            except HTTPException as e:
                logger.warning(f"Failed stats for fixture {fixture_id}: {e.detail}")
                continue
            for team_stats in stats_data.get("response", []):
                for pdata in team_stats.get("players", []):
                    ext_pid = str(pdata.get("player", {}).get("id"))
                    local_id = ext_to_local.get(ext_pid)
                    if not local_id:
                        continue
                    stats = (pdata.get("statistics") or [{}])[0]
                    rating_str = stats.get("games", {}).get("rating")
                    if rating_str is None:
                        continue  # did not play
                    try:
                        voto = float(rating_str)
                    except (TypeError, ValueError):
                        continue
                    goals = stats.get("goals", {}) or {}
                    cards = stats.get("cards", {}) or {}
                    penalty = stats.get("penalty", {}) or {}
                    passes = stats.get("passes", {}) or {}
                    vote_dict = {
                        "voto": voto,
                        "gol": int(goals.get("total") or 0),
                        "assist": int(passes.get("assists") or goals.get("assists") or 0),
                        "ammoniz": bool(cards.get("yellow")),
                        "espuls": bool(cards.get("red")),
                        "autogol": 0,
                        "gol_subiti": int(goals.get("conceded") or 0),
                        "rigore_segnato": int(penalty.get("scored") or 0),
                        "rigore_sbagliato": int(penalty.get("missed") or 0),
                        "rigore_parato": int(penalty.get("saved") or 0),
                        "gol_vittoria": 0,
                        "gol_pareggio": 0,
                    }
                    player_doc = await db.players.find_one({"id": local_id}, {"_id": 0})
                    role = player_doc.get("role") if player_doc else "C"
                    fv = fantavoto_from_vote(vote_dict, role)
                    await db.votes.update_one(
                        {"league_id": league_id, "matchday": matchday, "player_id": local_id},
                        {"$set": {
                            "league_id": league_id,
                            "matchday": matchday,
                            "player_id": local_id,
                            **vote_dict,
                            "fantavoto": fv,
                            "source": "api-football",
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        }},
                        upsert=True,
                    )
                    collected_votes += 1
            await asyncio.sleep(0.1)
    return {"ok": True, "matchday": matchday, "votes_synced": collected_votes, "season": target_season}


def _compute_user_total(lineup: dict, votes: dict[str, dict], players_map: dict[str, dict], api_votes: dict[str, dict] | None = None) -> tuple[float, list, list]:
    """Compute user total for a matchday applying auto-substitutions from bench.

    Vote resolution priority: league-specific manual votes > global api_votes cache.
    Returns (total, breakdown, substitutions).
    """
    api_votes = api_votes or {}

    def _get_vote(pid: str) -> Optional[dict]:
        return votes.get(pid) or api_votes.get(pid)

    starter_ids = list(lineup.get("starters", []))
    bench_ids = list(lineup.get("bench", []))
    used_bench: set[str] = set()
    total = 0.0
    breakdown = []
    substitutions = []
    for pid in starter_ids:
        v = _get_vote(pid)
        player = players_map.get(pid)
        role = player.get("role") if player else None
        if v:
            total += v["fantavoto"]
            breakdown.append({"player_id": pid, "fantavoto": v["fantavoto"], "has_vote": True, "substituted": False})
            continue
        sub_pid = None
        if role:
            for bp in bench_ids:
                if bp in used_bench:
                    continue
                bp_player = players_map.get(bp)
                if not bp_player or bp_player.get("role") != role:
                    continue
                if _get_vote(bp):
                    sub_pid = bp
                    break
        if sub_pid:
            sub_vote = _get_vote(sub_pid)
            used_bench.add(sub_pid)
            total += sub_vote["fantavoto"]
            breakdown.append({
                "player_id": pid,
                "fantavoto": sub_vote["fantavoto"],
                "has_vote": True,
                "substituted": True,
                "sub_player_id": sub_pid,
            })
            substitutions.append({"out": pid, "in": sub_pid})
        else:
            breakdown.append({"player_id": pid, "fantavoto": 0.0, "has_vote": False, "substituted": False})
    return total, breakdown, substitutions


@api.get("/leagues/{league_id}/results/{matchday}")
async def matchday_results(league_id: str, matchday: int, user: dict = Depends(get_current_user)):
    """Return leaderboard for a matchday with auto-substitution from bench.

    Vote sources: league-specific manual votes (admin override) + global api_votes cache.
    """
    member = await db.memberships.find_one({"league_id": league_id, "user_id": user["id"]})
    if not member:
        raise HTTPException(status_code=403, detail="Accesso negato")

    votes = {v["player_id"]: v async for v in db.votes.find(
        {"league_id": league_id, "matchday": matchday}, {"_id": 0}
    )}
    api_votes = {v["player_id"]: v async for v in db.api_votes.find(
        {"matchday": matchday}, {"_id": 0}
    )}
    lineups_docs = [ln async for ln in db.lineups.find(
        {"league_id": league_id, "matchday": matchday}, {"_id": 0}
    )]
    all_ids: set[str] = set()
    for ln in lineups_docs:
        all_ids.update(ln.get("starters", []))
        all_ids.update(ln.get("bench", []))
    players_map: dict[str, dict] = {}
    if all_ids:
        async for p in db.players.find({"id": {"$in": list(all_ids)}}, {"_id": 0}):
            players_map[p["id"]] = p

    results = []
    for lineup in lineups_docs:
        total, breakdown, substitutions = _compute_user_total(lineup, votes, players_map, api_votes)
        user_doc = await db.users.find_one({"id": lineup["user_id"]}, {"_id": 0, "password_hash": 0})
        results.append({
            "user_id": lineup["user_id"],
            "username": user_doc["username"] if user_doc else "?",
            "total": round(total, 2),
            "module": lineup.get("module"),
            "breakdown": breakdown,
            "substitutions": substitutions,
        })
    results.sort(key=lambda x: x["total"], reverse=True)
    for i, r in enumerate(results):
        r["rank"] = i + 1
        r["is_winner"] = i == 0 and r["total"] > 0
    return {"matchday": matchday, "results": results}


@api.get("/leagues/{league_id}/leaderboard")
async def overall_leaderboard(league_id: str, user: dict = Depends(get_current_user)):
    """Total points across all played matchdays. Each matchday winner gets 3 points, 2nd 2, 3rd 1."""
    member = await db.memberships.find_one({"league_id": league_id, "user_id": user["id"]})
    if not member:
        raise HTTPException(status_code=403, detail="Accesso negato")

    # Get all matchdays that have votes
    matchdays = await db.votes.distinct("matchday", {"league_id": league_id})

    # Get all members
    memberships = db.memberships.find({"league_id": league_id}, {"_id": 0})
    member_ids = [m["user_id"] async for m in memberships]
    users_map = {}
    users_cur = db.users.find({"id": {"$in": member_ids}}, {"_id": 0, "password_hash": 0})
    async for u in users_cur:
        users_map[u["id"]] = u["username"]

    scores = {uid: {"user_id": uid, "username": users_map.get(uid, "?"),
                    "total_fantavoto": 0.0, "wins": 0, "points": 0, "matchdays_played": 0}
              for uid in member_ids}

    for md in matchdays:
        # compute per matchday
        votes = {v["player_id"]: v async for v in db.votes.find(
            {"league_id": league_id, "matchday": md}, {"_id": 0}
        )}
        md_results = []
        lineups_cur = db.lineups.find({"league_id": league_id, "matchday": md}, {"_id": 0})
        async for lineup in lineups_cur:
            total = sum(votes.get(pid, {}).get("fantavoto", 0.0) for pid in lineup.get("starters", []))
            md_results.append((lineup["user_id"], total))
        md_results.sort(key=lambda x: x[1], reverse=True)
        for i, (uid, total) in enumerate(md_results):
            if uid in scores:
                scores[uid]["total_fantavoto"] += total
                scores[uid]["matchdays_played"] += 1
                if i == 0 and total > 0:
                    scores[uid]["wins"] += 1
                    scores[uid]["points"] += 3
                elif i == 1:
                    scores[uid]["points"] += 2
                elif i == 2:
                    scores[uid]["points"] += 1

    out = list(scores.values())
    for r in out:
        r["total_fantavoto"] = round(r["total_fantavoto"], 2)
    out.sort(key=lambda x: (x["points"], x["total_fantavoto"]), reverse=True)
    for i, r in enumerate(out):
        r["rank"] = i + 1
    return {"leaderboard": out, "matchdays_played": len(matchdays)}


@api.get("/leagues/{league_id}/history")
async def matchday_history(league_id: str, user: dict = Depends(get_current_user)):
    """List all played matchdays with their winners (using bench substitutions).

    Matchdays with either league-specific votes OR global api_votes are considered played.
    """
    member = await db.memberships.find_one({"league_id": league_id, "user_id": user["id"]})
    if not member:
        raise HTTPException(status_code=403, detail="Accesso negato")
    md_set = set(await db.votes.distinct("matchday", {"league_id": league_id}))
    md_set.update(await db.api_votes.distinct("matchday"))
    matchdays = sorted(md_set)
    out = []
    for md in matchdays:
        votes = {v["player_id"]: v async for v in db.votes.find(
            {"league_id": league_id, "matchday": md}, {"_id": 0}
        )}
        api_votes = {v["player_id"]: v async for v in db.api_votes.find(
            {"matchday": md}, {"_id": 0}
        )}
        lineups_docs = [ln async for ln in db.lineups.find(
            {"league_id": league_id, "matchday": md}, {"_id": 0}
        )]
        all_ids: set[str] = set()
        for ln in lineups_docs:
            all_ids.update(ln.get("starters", []))
            all_ids.update(ln.get("bench", []))
        players_map: dict[str, dict] = {}
        if all_ids:
            async for p in db.players.find({"id": {"$in": list(all_ids)}}, {"_id": 0}):
                players_map[p["id"]] = p
        best = None
        for lineup in lineups_docs:
            total, _, _ = _compute_user_total(lineup, votes, players_map, api_votes)
            if best is None or total > best[1]:
                best = (lineup["user_id"], total)
        if not best:
            continue
        u = await db.users.find_one({"id": best[0]}, {"_id": 0, "password_hash": 0})
        winner_name = u["username"] if u else "?"
        out.append({
            "matchday": md,
            "winner_username": winner_name,
            "winner_score": round(best[1], 2),
        })
    return {"history": out}


# ============ System / Scheduler admin ============
class SystemMatchdayIn(BaseModel):
    matchday: int = Field(ge=1, le=38)


class SystemSchedulerIn(BaseModel):
    enabled: bool


@api.get("/system")
async def get_system(user: dict = Depends(get_current_user)):
    """Public system status (any authenticated user can read)."""
    md = await _system_get("current_matchday", 1)
    enabled = await _system_get("scheduler_enabled", SCHEDULER_ENABLED)
    last_at = await _system_get("last_scheduled_sync_at")
    last_count = await _system_get("last_scheduled_sync_count", 0)
    last_err = await _system_get("last_scheduled_sync_error")
    api_votes_by_md = {}
    async for doc in db.api_votes.aggregate([{"$group": {"_id": "$matchday", "n": {"$sum": 1}}}]):
        api_votes_by_md[str(doc["_id"])] = doc["n"]
    now_local = datetime.now(ROME_TZ)
    return {
        "current_matchday": md,
        "current_season": CURRENT_SEASON,
        "scheduler_enabled": enabled,
        "scheduler_running": SCHEDULER_ENABLED and bool(API_FOOTBALL_KEY),
        "in_match_window": _in_match_window(now_local),
        "server_time_rome": now_local.strftime("%Y-%m-%d %H:%M %Z"),
        "last_scheduled_sync_at": last_at,
        "last_scheduled_sync_count": last_count,
        "last_scheduled_sync_error": last_err,
        "api_votes_by_matchday": api_votes_by_md,
        "match_windows": {str(k): v for k, v in MATCH_WINDOWS.items()},
    }


@api.post("/system/matchday")
async def set_current_matchday(
    data: SystemMatchdayIn, admin: dict = Depends(require_system_admin)
):
    await _system_set("current_matchday", data.matchday)
    return {"ok": True, "current_matchday": data.matchday}


@api.post("/system/scheduler")
async def set_scheduler_enabled(
    data: SystemSchedulerIn, admin: dict = Depends(require_system_admin)
):
    await _system_set("scheduler_enabled", data.enabled)
    return {"ok": True, "scheduler_enabled": data.enabled}


@api.post("/system/sync-now")
async def system_sync_now(admin: dict = Depends(require_system_admin)):
    """Trigger an immediate sync of the current matchday votes (respects gap check).

    Returns votes_synced or upstream error.
    """
    matchday = int(await _system_get("current_matchday", 1))
    season = int(await _system_get("current_season", CURRENT_SEASON))
    count = await _sync_matchday_votes_global(matchday, season)
    await _system_set("last_scheduled_sync_at", datetime.now(timezone.utc).isoformat())
    await _system_set("last_scheduled_sync_count", count)
    await _system_set("last_scheduled_sync_error", None)
    return {"ok": True, "matchday": matchday, "votes_synced": count}


# ============ Health ============
@api.get("/")
async def root():
    return {"service": "FantaGiornata", "status": "ok"}


# Mount
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
