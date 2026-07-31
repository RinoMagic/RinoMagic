"""SchedinaBar — mini-fantacalcio Serie A challenge among friends.

Flow:
1. Admin creates a Room for a matchday (with color + max_events per schedina)
2. Friends join with invite code + nickname (no password)
3. Each user uploads a betting-slip screenshot → OCR parses events + odds
4. User confirms/edits parsed events → stored in DB
5. Admin fetches or manually inputs the Serie A matchday results
6. System computes each user's product-of-odds on WON predictions only
7. Leaderboard: highest total wins, lowest pays.
"""
import os
import re
import io
import uuid
import base64
import string
import random
import logging
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Dict, Any

import jwt
import httpx
import pytesseract
from PIL import Image, ImageOps, ImageFilter
from fastapi import FastAPI, APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, field_validator

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_MINUTES = int(os.environ.get("ACCESS_TOKEN_MINUTES", "20160"))
API_FOOTBALL_KEY = os.environ.get("API_FOOTBALL_KEY", "").strip()
API_FOOTBALL_BASE = os.environ.get("API_FOOTBALL_BASE", "https://v3.football.api-sports.io").rstrip("/")
SERIE_A_LEAGUE_ID = int(os.environ.get("SERIE_A_LEAGUE_ID", "135"))
CURRENT_SEASON = int(os.environ.get("CURRENT_SEASON", "2024"))
TESSERACT_LANG = os.environ.get("TESSERACT_LANG", "ita+eng")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="SchedinaBar API")
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)
logger = logging.getLogger("schedinabar")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")


# ============ Models ============
ROOM_COLORS = ["#00D95F", "#FFB300", "#EF4444", "#3B82F6", "#A855F7", "#EC4899", "#14B8A6", "#F97316"]

VALID_PREDICTIONS = {"1", "X", "2", "1X", "X2", "12", "GOL", "NOGOL", "OVER", "UNDER"}


class RoomCreate(BaseModel):
    name: str = Field(min_length=2, max_length=40)
    matchday: int = Field(ge=1, le=38)
    max_events: int = Field(ge=1, le=10, default=5)
    color: Optional[str] = None
    admin_nickname: str = Field(min_length=2, max_length=20)


class RoomJoin(BaseModel):
    invite_code: str
    nickname: str = Field(min_length=2, max_length=20)


class SchedinaEventIn(BaseModel):
    home_team: str
    away_team: str
    prediction: str
    odd: float = Field(gt=0, le=1000)

    @field_validator("prediction")
    @classmethod
    def _norm_pred(cls, v: str) -> str:
        v2 = v.upper().replace(" ", "").replace(".", "")
        if v2 not in VALID_PREDICTIONS:
            # accept OVER25 -> OVER, UNDER25 -> UNDER
            for base in ("OVER", "UNDER"):
                if v2.startswith(base):
                    return base
            raise ValueError(f"Pronostico non valido: {v}")
        return v2


class SchedinaConfirm(BaseModel):
    events: List[SchedinaEventIn]


class FixtureIn(BaseModel):
    home_team: str
    away_team: str
    home_score: int = Field(ge=0)
    away_score: int = Field(ge=0)
    both_scored: Optional[bool] = None  # if None, computed from scores


class FixturesIn(BaseModel):
    fixtures: List[FixtureIn]


# ============ Helpers ============
def gen_code(n: int = 6) -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=n))


def create_token(room_id: str, nickname: str, is_admin: bool) -> str:
    payload = {
        "room_id": room_id,
        "nickname": nickname,
        "is_admin": is_admin,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def current_session(cred: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> dict:
    if not cred:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(cred.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    # Sanity: verify membership still exists
    m = await db.memberships.find_one(
        {"room_id": payload["room_id"], "nickname": payload["nickname"]}, {"_id": 0}
    )
    if not m:
        raise HTTPException(status_code=401, detail="Session invalid")
    return payload


def _norm_team(name: str) -> str:
    """Aggressive team-name normalization for matching predictions vs results.

    Lowercase, strip punctuation, remove common suffixes (FC, AC, CF, US, ...).
    """
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(
        r"\b(fc|ac|cf|us|ss|calcio|football|club|serie|a)\b",
        " ",
        s,
    )
    return re.sub(r"\s+", " ", s).strip()


def _team_match(a: str, b: str) -> bool:
    na, nb = _norm_team(a), _norm_team(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    # Substring / token overlap heuristic
    if na in nb or nb in na:
        return True
    ta, tb = set(na.split()), set(nb.split())
    if not ta or not tb:
        return False
    overlap = ta & tb
    return len(overlap) >= 1 and len(overlap) >= min(len(ta), len(tb)) // 2


def _evaluate_prediction(pred: str, home: int, away: int) -> bool:
    """Return True if `pred` is correct given final score home-away."""
    pred = pred.upper().replace(" ", "")
    if pred == "1":
        return home > away
    if pred == "X":
        return home == away
    if pred == "2":
        return home < away
    if pred == "1X":
        return home >= away
    if pred == "X2":
        return home <= away
    if pred == "12":
        return home != away
    if pred == "GOL":
        return home > 0 and away > 0
    if pred == "NOGOL":
        return home == 0 or away == 0
    if pred == "OVER":
        return (home + away) > 2  # Over 2.5
    if pred == "UNDER":
        return (home + away) < 3  # Under 2.5
    return False


# ============ OCR ============
def _preprocess_image(raw_bytes: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
    # Resize up if small
    w, h = img.size
    if w < 900:
        scale = 900 / w
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    # Convert to grayscale + increase contrast + slight sharpen
    gray = ImageOps.grayscale(img)
    gray = ImageOps.autocontrast(gray, cutoff=2)
    gray = gray.filter(ImageFilter.SHARPEN)
    return gray


# ---- staryes.it bet-slip parser --------------------------------------------
# Each event block on staryes.it looks like:
#   CALCIO - SERIE A | 18:30           <-- header line (competition + kickoff)
#   7965  FROSINONE  -  JUVENTUS       <-- optional event id + teams
#   1X2: 2                       1.46  <-- market + prediction + odd
STARYES_HEADER_RE = re.compile(
    r"CALCIO\s*[-–]\s*SERIE\s*A", re.IGNORECASE
)
# Team line: optional 3-5 digit event id, then TEAM_A - TEAM_B (uppercase words).
STARYES_TEAMS_RE = re.compile(
    r"^\s*(?:\d{3,5}\s+)?([A-ZÀ-Ú][A-ZÀ-Ú\s.'’]+?)\s+[-–]\s+([A-ZÀ-Ú][A-ZÀ-Ú\s.'’]+?)\s*$"
)
STARYES_ODD_TAIL_RE = re.compile(r"([1-9]\d?[.,]\d{1,3})\s*$")


def _titleize(name: str) -> str:
    """FROSINONE -> Frosinone;  HELLAS VERONA -> Hellas Verona."""
    parts = re.split(r"(\s+)", name.strip())
    return "".join(p if p.isspace() else (p[:1].upper() + p[1:].lower()) for p in parts)


def _normalize_prediction(fragment: str) -> Optional[str]:
    """Given a fragment like '1X2: 2', 'G/NG: GOL' or 'U/O 1,5: UNDER'
    return the normalized prediction code (1/X/2/1X/X2/12/GOL/NOGOL/OVER/UNDER)."""
    if not fragment:
        return None
    text = fragment.upper()
    # Take part after the last colon if present, otherwise the last token.
    if ":" in text:
        pred = text.rsplit(":", 1)[1]
    else:
        tokens = text.replace(",", " ").split()
        pred = tokens[-1] if tokens else ""
    pred = re.sub(r"[^A-Z0-9]", "", pred)
    # Common OCR aliases
    if pred in {"NOGOL", "NG"}:
        return "NOGOL"
    if pred in {"GOL", "GG"}:
        return "GOL"
    if pred.startswith("NO"):
        return "NOGOL"
    if pred.startswith("OVER") or pred == "O":
        return "OVER"
    if pred.startswith("UNDER") or pred == "U":
        return "UNDER"
    if pred in {"1", "2", "X"}:
        return pred
    if pred in {"1X", "X1"}:
        return "1X"
    if pred in {"X2", "2X"}:
        return "X2"
    if pred in {"12", "21"}:
        return "12"
    return None


def _parse_staryes_slip(raw_text: str) -> List[dict]:
    """Parse a staryes.it bet slip out of raw OCR text.

    Strategy:
      1. Split OCR text in trimmed non-empty lines.
      2. Locate `CALCIO - SERIE A` header lines as block anchors.
      3. Within each block (until next header), look for a `TEAM - TEAM` line
         and a bet line ending with an odd. Missing anchors are tolerated
         (some slips only show teams+bet without a re-printed header).
    """
    lines = [ln.strip() for ln in raw_text.splitlines() if ln.strip()]
    if not lines:
        return []

    # Indexes of header lines act as event separators.
    header_idx = [i for i, ln in enumerate(lines) if STARYES_HEADER_RE.search(ln)]
    if not header_idx:
        # Fallback: treat the whole text as one block
        header_idx = [0]

    events: List[dict] = []
    for i, hi in enumerate(header_idx):
        end = header_idx[i + 1] if i + 1 < len(header_idx) else len(lines)
        block = lines[hi:end]
        home = away = prediction = None
        odd: Optional[float] = None
        for ln in block:
            if home is None:
                m = STARYES_TEAMS_RE.match(ln)
                if m:
                    home, away = m.group(1).strip(), m.group(2).strip()
                    continue
            if odd is None:
                om = STARYES_ODD_TAIL_RE.search(ln)
                if om:
                    try:
                        candidate = float(om.group(1).replace(",", "."))
                    except ValueError:
                        candidate = 0.0
                    if 1.01 <= candidate <= 999:
                        pred_fragment = ln[: om.start()].strip()
                        pred = _normalize_prediction(pred_fragment)
                        if pred:
                            odd = candidate
                            prediction = pred
        if home and away and prediction and odd:
            events.append({
                "home_team": _titleize(home),
                "away_team": _titleize(away),
                "prediction": prediction,
                "odd": round(odd, 3),
            })

    # Dedup by (home, away, prediction)
    seen = set()
    dedup: List[dict] = []
    for e in events:
        key = (e["home_team"].lower(), e["away_team"].lower(), e["prediction"])
        if key in seen:
            continue
        seen.add(key)
        dedup.append(e)
    return dedup


async def ocr_screenshot(image_bytes: bytes) -> Dict[str, Any]:
    """Run OCR with two strategies (raw + preprocessed) and pick the best
    parsed result. The staryes.it slip uses light blue text over a dark blue
    background: heavy preprocessing sometimes wipes the coloured predictions,
    so keeping the raw image as a fallback is important."""
    original = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    processed = _preprocess_image(image_bytes)

    best_text = ""
    best_events: List[dict] = []
    for candidate in (original, processed):
        try:
            text = pytesseract.image_to_string(candidate, lang=TESSERACT_LANG)
        except Exception as exc:  # pragma: no cover - tesseract missing/bad
            logger.warning("OCR failure: %s", exc)
            continue
        events = _parse_staryes_slip(text)
        if len(events) > len(best_events):
            best_events = events
            best_text = text
        elif not best_text:
            best_text = text
    return {"raw_text": best_text, "events": best_events}


# ============ Startup ============
@app.on_event("startup")
async def startup():
    await db.rooms.create_index("id", unique=True)
    await db.rooms.create_index("invite_code", unique=True)
    await db.memberships.create_index([("room_id", 1), ("nickname", 1)], unique=True)
    await db.schedine.create_index([("room_id", 1), ("nickname", 1)], unique=True)
    await db.fixtures.create_index([("room_id", 1), ("home_team", 1), ("away_team", 1)], unique=True)
    logger.info("SchedinaBar API started")


@app.on_event("shutdown")
async def shutdown():
    client.close()


# ============ Rooms ============
async def _room_dict(room: dict, viewer_nickname: Optional[str] = None) -> dict:
    members_count = await db.memberships.count_documents({"room_id": room["id"]})
    settled = room.get("status") == "settled"
    return {
        "id": room["id"],
        "name": room["name"],
        "matchday": room["matchday"],
        "max_events": room["max_events"],
        "color": room["color"],
        "invite_code": room["invite_code"],
        "admin_nickname": room["admin_nickname"],
        "status": room.get("status", "open"),
        "created_at": room["created_at"],
        "members_count": members_count,
        "settled": settled,
        "is_admin": viewer_nickname == room["admin_nickname"] if viewer_nickname else False,
    }


@api.post("/rooms")
async def create_room(data: RoomCreate):
    for _ in range(10):
        code = gen_code()
        if not await db.rooms.find_one({"invite_code": code}):
            break
    room_id = str(uuid.uuid4())
    color = data.color if data.color in ROOM_COLORS else random.choice(ROOM_COLORS)
    doc = {
        "id": room_id,
        "name": data.name,
        "matchday": data.matchday,
        "max_events": data.max_events,
        "color": color,
        "invite_code": code,
        "admin_nickname": data.admin_nickname.strip(),
        "status": "open",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.rooms.insert_one(doc)
    await db.memberships.insert_one({
        "room_id": room_id,
        "nickname": data.admin_nickname.strip(),
        "is_admin": True,
        "joined_at": datetime.now(timezone.utc).isoformat(),
    })
    token = create_token(room_id, data.admin_nickname.strip(), True)
    return {
        "token": token,
        "room": await _room_dict(doc, data.admin_nickname.strip()),
    }


@api.post("/rooms/join")
async def join_room(data: RoomJoin):
    room = await db.rooms.find_one({"invite_code": data.invite_code.upper()}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Codice invito non valido")
    if room.get("status") == "settled":
        raise HTTPException(status_code=400, detail="Stanza gia chiusa")
    nickname = data.nickname.strip()
    existing = await db.memberships.find_one(
        {"room_id": room["id"], "nickname": nickname}
    )
    if not existing:
        # Enforce uniqueness of nickname in the room (case-insensitive)
        conflict = await db.memberships.find_one({
            "room_id": room["id"],
            "nickname": {"$regex": f"^{re.escape(nickname)}$", "$options": "i"},
        })
        if conflict:
            raise HTTPException(status_code=409, detail="Nickname gia usato in questa stanza")
        await db.memberships.insert_one({
            "room_id": room["id"],
            "nickname": nickname,
            "is_admin": False,
            "joined_at": datetime.now(timezone.utc).isoformat(),
        })
    is_admin = nickname == room["admin_nickname"]
    token = create_token(room["id"], nickname, is_admin)
    return {"token": token, "room": await _room_dict(room, nickname)}


@api.get("/rooms/{room_id}")
async def get_room(room_id: str, session: dict = Depends(current_session)):
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Stanza non trovata")
    return await _room_dict(room, session["nickname"])


@api.get("/rooms/{room_id}/members")
async def list_members(room_id: str, session: dict = Depends(current_session)):
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
    cursor = db.memberships.find({"room_id": room_id}, {"_id": 0})
    members = [m async for m in cursor]
    # Enrich with schedina submitted flag
    submitted = set()
    async for s in db.schedine.find({"room_id": room_id, "status": "confirmed"}, {"nickname": 1, "_id": 0}):
        submitted.add(s["nickname"])
    for m in members:
        m["submitted"] = m["nickname"] in submitted
    return members


@api.post("/rooms/{room_id}/close")
async def close_room(room_id: str, session: dict = Depends(current_session)):
    if not session.get("is_admin"):
        raise HTTPException(status_code=403, detail="Solo l'admin puo chiudere la stanza")
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
    await db.rooms.update_one({"id": room_id}, {"$set": {"status": "closed"}})
    return {"ok": True}


# ============ Schedina / OCR ============
class ScreenshotIn(BaseModel):
    image_base64: str


@api.post("/rooms/{room_id}/schedina/ocr")
async def upload_schedina(room_id: str, data: ScreenshotIn, session: dict = Depends(current_session)):
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Stanza non trovata")
    if room.get("status") == "settled":
        raise HTTPException(status_code=400, detail="Stanza chiusa")

    b64 = data.image_base64
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Immagine base64 non valida")

    # Persist draft with screenshot + parsed events
    result = await ocr_screenshot(raw)
    parsed = result["events"]
    if len(parsed) > room["max_events"]:
        parsed = parsed[: room["max_events"]]

    await db.schedine.update_one(
        {"room_id": room_id, "nickname": session["nickname"]},
        {"$set": {
            "room_id": room_id,
            "nickname": session["nickname"],
            "screenshot_base64": b64,
            "raw_text": result["raw_text"],
            "events": parsed,
            "status": "draft",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return {"events": parsed, "raw_text": result["raw_text"], "max_events": room["max_events"]}


@api.post("/rooms/{room_id}/schedina/confirm")
async def confirm_schedina(room_id: str, data: SchedinaConfirm, session: dict = Depends(current_session)):
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Stanza non trovata")
    if room.get("status") == "settled":
        raise HTTPException(status_code=400, detail="Stanza chiusa")
    if not data.events:
        raise HTTPException(status_code=400, detail="La schedina deve avere almeno un pronostico")
    if len(data.events) > room["max_events"]:
        raise HTTPException(status_code=400, detail=f"Massimo {room['max_events']} pronostici")

    events = [e.model_dump() for e in data.events]
    await db.schedine.update_one(
        {"room_id": room_id, "nickname": session["nickname"]},
        {"$set": {
            "room_id": room_id,
            "nickname": session["nickname"],
            "events": events,
            "status": "confirmed",
            "confirmed_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return {"ok": True, "events": events}


@api.get("/rooms/{room_id}/schedina")
async def my_schedina(room_id: str, session: dict = Depends(current_session)):
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
    s = await db.schedine.find_one(
        {"room_id": room_id, "nickname": session["nickname"]},
        {"_id": 0, "screenshot_base64": 0, "raw_text": 0},
    )
    return s or {"empty": True}


# ============ Fixtures / Results ============
@api.post("/rooms/{room_id}/fixtures")
async def set_fixtures(room_id: str, data: FixturesIn, session: dict = Depends(current_session)):
    if not session.get("is_admin"):
        raise HTTPException(status_code=403, detail="Solo l'admin puo inserire i risultati")
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
    await db.fixtures.delete_many({"room_id": room_id})
    docs = []
    for f in data.fixtures:
        both = f.both_scored if f.both_scored is not None else (f.home_score > 0 and f.away_score > 0)
        docs.append({
            "room_id": room_id,
            "home_team": f.home_team.strip(),
            "away_team": f.away_team.strip(),
            "home_score": f.home_score,
            "away_score": f.away_score,
            "both_scored": both,
        })
    if docs:
        await db.fixtures.insert_many(docs)
    return {"ok": True, "count": len(docs)}


@api.get("/rooms/{room_id}/fixtures")
async def get_fixtures(room_id: str, session: dict = Depends(current_session)):
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
    cursor = db.fixtures.find({"room_id": room_id}, {"_id": 0})
    return [f async for f in cursor]


@api.post("/rooms/{room_id}/fixtures/sync")
async def sync_fixtures_from_api(room_id: str, season: Optional[int] = None, session: dict = Depends(current_session)):
    if not session.get("is_admin"):
        raise HTTPException(status_code=403, detail="Solo l'admin")
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
    if not API_FOOTBALL_KEY:
        raise HTTPException(status_code=400, detail="API_FOOTBALL_KEY non configurata")
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Stanza non trovata")
    target_season = season or CURRENT_SEASON
    headers = {"x-apisports-key": API_FOOTBALL_KEY}
    async with httpx.AsyncClient(timeout=20) as http:
        try:
            r = await http.get(
                f"{API_FOOTBALL_BASE}/fixtures",
                params={
                    "league": SERIE_A_LEAGUE_ID,
                    "season": target_season,
                    "round": f"Regular Season - {room['matchday']}",
                },
                headers=headers,
            )
            r.raise_for_status()
        except httpx.HTTPError as e:
            raise HTTPException(status_code=400, detail=f"API-Football: {type(e).__name__}")
        data = r.json()
        errs = data.get("errors") or {}
        if isinstance(errs, dict) and errs:
            raise HTTPException(status_code=400, detail=f"API-Football: {next(iter(errs.values()))}")
        fixtures = data.get("response", [])
        if not fixtures:
            raise HTTPException(status_code=400, detail="Nessuna partita ricevuta dall'API")

    await db.fixtures.delete_many({"room_id": room_id})
    docs = []
    for f in fixtures:
        goals = f.get("goals", {}) or {}
        home_score = goals.get("home")
        away_score = goals.get("away")
        if home_score is None or away_score is None:
            continue
        teams = f.get("teams", {}) or {}
        home = teams.get("home", {}).get("name") or ""
        away = teams.get("away", {}).get("name") or ""
        if not home or not away:
            continue
        docs.append({
            "room_id": room_id,
            "home_team": home,
            "away_team": away,
            "home_score": int(home_score),
            "away_score": int(away_score),
            "both_scored": home_score > 0 and away_score > 0,
        })
    if docs:
        await db.fixtures.insert_many(docs)
    return {"ok": True, "count": len(docs)}


# ============ Leaderboard ============
def _match_prediction_to_fixture(event: dict, fixtures: list[dict]) -> Optional[dict]:
    for f in fixtures:
        if _team_match(event["home_team"], f["home_team"]) and _team_match(event["away_team"], f["away_team"]):
            return f
        # Also try swapped (in case OCR got them backwards)
        if _team_match(event["home_team"], f["away_team"]) and _team_match(event["away_team"], f["home_team"]):
            return f
    return None


@api.get("/rooms/{room_id}/leaderboard")
async def leaderboard(room_id: str, session: dict = Depends(current_session)):
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
    fixtures = [f async for f in db.fixtures.find({"room_id": room_id}, {"_id": 0})]
    has_results = len(fixtures) > 0

    schedine_cur = db.schedine.find({"room_id": room_id, "status": "confirmed"}, {"_id": 0})
    entries = []
    async for s in schedine_cur:
        events = s.get("events", [])
        breakdown = []
        product = 1.0
        won_count = 0
        for e in events:
            info = {
                "home_team": e["home_team"],
                "away_team": e["away_team"],
                "prediction": e["prediction"],
                "odd": e["odd"],
                "won": False,
                "matched_fixture": None,
                "score": None,
            }
            if has_results:
                fx = _match_prediction_to_fixture(e, fixtures)
                if fx:
                    info["matched_fixture"] = f"{fx['home_team']} vs {fx['away_team']}"
                    info["score"] = f"{fx['home_score']}-{fx['away_score']}"
                    if _evaluate_prediction(e["prediction"], fx["home_score"], fx["away_score"]):
                        info["won"] = True
                        product *= e["odd"]
                        won_count += 1
            breakdown.append(info)
        total = round(product, 2) if won_count > 0 else 0.0
        entries.append({
            "nickname": s["nickname"],
            "total": total,
            "won_count": won_count,
            "events_count": len(events),
            "breakdown": breakdown,
        })
    entries.sort(key=lambda x: (-x["total"], x["nickname"]))
    for i, r in enumerate(entries):
        r["rank"] = i + 1
    return {
        "has_results": has_results,
        "settled": has_results and len(entries) > 0,
        "leaderboard": entries,
    }


@api.get("/")
async def root():
    return {"service": "SchedinaBar", "status": "ok"}


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
