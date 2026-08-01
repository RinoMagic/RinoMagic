"""ScoreAndLive — mini-game module for the RinoMagic umbrella app.

Elimination tournament based on guessing goalscorers. Each matchday a player
picks one scorer per playable fixture; a missed pick costs a life. Zero lives
means elimination. Once a scorer is hit, the whole team is off-limits for the
rest of the tournament. Postponed matches never cost lives.

**Deadlock deroga (Option B rule)**: if both teams of a specific fixture are
already blocked for the user, that fixture accepts any pick regardless (the
pick is stored with ``deadlock_override: True``). This avoids situations where
a player would be unable to make a valid pick because both fixture sides are
already blocked.

Data model (all collections prefixed with `sal_`):

* ``sal_players``        — reference roster (imported from Excel/CSV/PDF)
* ``sal_tournaments``    — one running elimination tournament
* ``sal_matchdays``      — a matchday inside a tournament
* ``sal_picks``          — the picks a player submits for a matchday
* ``sal_participants``   — per-tournament state (lives, blocked teams, ...)
"""
from __future__ import annotations

import re
import uuid
import string
import random
import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any, Callable

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel, Field, field_validator
from pymongo import ReturnDocument

logger = logging.getLogger("scoreandlive")

# Serie A 2025-26 team names — used to anchor the listone parser. Update this
# set when new teams are promoted/relegated (kept explicit so we can adapt
# quickly without changing the regex).
SERIE_A_TEAMS = {
    "Atalanta", "Bologna", "Cagliari", "Como", "Cremonese", "Fiorentina",
    "Genoa", "Inter", "Juventus", "Lazio", "Lecce", "Milan", "Napoli",
    "Parma", "Pisa", "Roma", "Sassuolo", "Torino", "Udinese", "Verona",
}


def _parse_listone_pdf(pdf_bytes: bytes) -> List[dict]:
    """Extract Serie A players from a "Listone Fantacalcio" PDF.

    Expected layout (one row per player, whitespace-separated):
        <Id> <R> <RM> <Cognome[ Inizialesuffisso.]> <Squadra> <QtA> <QtI> <Diff> <QtAM> <QtIM>

    Returns a list of dicts ready to be inserted in ``sal_players``. Rows that
    don't match are silently skipped (typical for headers, page numbers or the
    Mantra variant appended to the same PDF).
    """
    try:
        import pdfplumber
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"pdfplumber non installato: {e}") from e

    import io as _io
    line_re = re.compile(
        r"^(\d+)\s+([PDCA])\s+(\S+)\s+(.+?)\s+(" + "|".join(SERIE_A_TEAMS) + r")\s+"
        r"(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*$"
    )
    seen_ids: set[int] = set()
    players: List[dict] = []
    with pdfplumber.open(_io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for line in text.split("\n"):
                line = line.strip()
                if not line or line.startswith("Id") or "Quotazioni" in line:
                    continue
                m = line_re.match(line)
                if not m:
                    continue
                fid, role, rm, name_field, team, qa, qi, _diff, _qam, _qim = m.groups()
                fid_int = int(fid)
                if fid_int in seen_ids:
                    continue  # de-dupe rows from the Mantra section
                seen_ids.add(fid_int)
                parts = name_field.split()
                if len(parts) >= 2 and re.fullmatch(r"[A-Z]\.", parts[-1]):
                    first = parts[-1]
                    last = " ".join(parts[:-1])
                else:
                    first = ""
                    last = name_field
                players.append({
                    "fanta_id": fid_int,
                    "first_name": first,
                    "last_name": last,
                    "team": team,
                    "role": role,
                    "role_mantra": rm,
                    "price_current": int(qa),
                    "price_initial": int(qi),
                })
    return players


# =========================================================================
# Pydantic models (shared)
# =========================================================================

class PlayerIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(min_length=1, max_length=60)
    team: str = Field(min_length=1, max_length=60)
    role: Optional[str] = None

    @field_validator("role")
    @classmethod
    def _norm_role(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        return (v.strip().upper()[:2]) or None


class PlayerImport(BaseModel):
    replace_all: bool = False
    players: List[PlayerIn]


class TournamentCreate(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    initial_lives: int = Field(default=10, ge=1, le=50)


class MatchdayFixtureIn(BaseModel):
    home_team: str = Field(min_length=1, max_length=60)
    away_team: str = Field(min_length=1, max_length=60)
    postponed: bool = False


class MatchdayCreate(BaseModel):
    matchday_number: int = Field(ge=1, le=38)
    # If ``fixtures`` is omitted OR empty, the endpoint auto-loads the 10
    # fixtures from the season calendar (``sal_calendar``) for that matchday.
    fixtures: Optional[List[MatchdayFixtureIn]] = None


class CalendarFixtureIn(BaseModel):
    matchday: int = Field(ge=1, le=38)
    home_team: str = Field(min_length=1, max_length=60)
    away_team: str = Field(min_length=1, max_length=60)
    kickoff_iso: Optional[str] = None  # optional ISO datetime


class CalendarImportIn(BaseModel):
    season: str = Field(default="2025-26", max_length=10)
    fixtures: List[CalendarFixtureIn]
    replace: bool = True  # wipes previous rows for the season before insert


class PickItem(BaseModel):
    fixture_idx: int = Field(ge=0)
    player_id: str


class PicksSubmit(BaseModel):
    picks: List[PickItem]


class ScorerEntry(BaseModel):
    fixture_idx: int
    player_id: str


class ResultsConfirm(BaseModel):
    scorers: List[ScorerEntry] = []
    postponed_during: List[int] = []


class InviteRedeem(BaseModel):
    invite_code: str


# =========================================================================
# Factory: builds the router with proper auth dependencies
# =========================================================================

def build_router(
    db,
    current_user: Callable,
    require_admin: Callable,
    display_name: Callable,
) -> APIRouter:
    """Return an APIRouter for ScoreAndLive.

    The auth dependencies (``current_user``, ``require_admin``) are captured
    in a closure so FastAPI can resolve them per-request.
    """

    router = APIRouter(prefix="/sal")

    # --- utils -----------------------------------------------------------

    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _gen_code(length: int = 6) -> str:
        alphabet = string.ascii_uppercase + string.digits
        return "".join(random.choices(alphabet, k=length))

    def _norm_team(name: str) -> str:
        return (name or "").strip().lower()

    async def _get_tournament(tournament_id: str) -> dict:
        t = await db.sal_tournaments.find_one({"id": tournament_id}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Torneo non trovato")
        return t

    async def _get_matchday(matchday_id: str) -> dict:
        md = await db.sal_matchdays.find_one({"id": matchday_id}, {"_id": 0})
        if not md:
            raise HTTPException(status_code=404, detail="Giornata non trovata")
        return md

    async def _require_tournament_admin(tournament_id: str, user: dict) -> dict:
        t = await _get_tournament(tournament_id)
        if user["role"] != "admin" and user["id"] != t.get("admin_user_id"):
            raise HTTPException(status_code=403, detail="Solo l'admin del torneo può eseguire questa azione")
        return t

    async def _participant(tournament_id: str, user_id: str) -> Optional[dict]:
        return await db.sal_participants.find_one(
            {"tournament_id": tournament_id, "user_id": user_id}, {"_id": 0}
        )

    async def _tournament_dict(t: dict, viewer: Optional[dict] = None) -> dict:
        total = await db.sal_participants.count_documents({"tournament_id": t["id"]})
        alive = await db.sal_participants.count_documents(
            {"tournament_id": t["id"], "eliminated_at_matchday": None}
        )
        is_admin = bool(
            viewer and (viewer["role"] == "admin" or viewer["id"] == t.get("admin_user_id"))
        )
        # Single-use invite stats (mirrors TheBestTiket rooms behaviour).
        invites_total = await db.sal_invites.count_documents(
            {"tournament_id": t["id"], "revoked_at": None}
        )
        invites_available = await db.sal_invites.count_documents(
            {"tournament_id": t["id"], "revoked_at": None, "used_by_user_id": None}
        )
        return {
            **{k: t.get(k) for k in ("id", "name", "status", "current_matchday_number",
                                     "initial_lives", "created_at", "admin_user_id",
                                     "invite_code", "winner_user_id")},
            "participants_total": total,
            "participants_alive": alive,
            "invites_total": invites_total,
            "invites_available": invites_available,
            "is_admin": is_admin,
        }

    async def _invite_dict(inv: dict) -> dict:
        used_nickname = None
        if inv.get("used_by_user_id"):
            u = await db.users.find_one({"id": inv["used_by_user_id"]}, {"_id": 0})
            if u:
                used_nickname = display_name(u)
        return {
            "id": inv["id"],
            "code": inv["code"],
            "tournament_id": inv["tournament_id"],
            "created_at": inv.get("created_at"),
            "created_by": inv.get("created_by"),
            "used_by_user_id": inv.get("used_by_user_id"),
            "used_by_nickname": used_nickname,
            "used_at": inv.get("used_at"),
            "revoked_at": inv.get("revoked_at"),
        }

    def _player_dict(p: dict) -> dict:
        return {
            "id": p["id"],
            "first_name": p.get("first_name"),
            "last_name": p.get("last_name"),
            "full_name": p.get("full_name") or (
                f"{p.get('first_name','').strip()} {p.get('last_name','').strip()}".strip()
            ),
            "team": p.get("team"),
            "role": p.get("role"),
        }

    # --- Players (listone) ---------------------------------------------

    @router.post("/players/import")
    async def import_players(data: PlayerImport, user: dict = Depends(require_admin)):
        if not data.players:
            raise HTTPException(status_code=400, detail="Nessun giocatore fornito")
        if data.replace_all:
            await db.sal_players.delete_many({})
        now = _now()
        docs = []
        for p in data.players:
            docs.append({
                "id": str(uuid.uuid4()),
                "first_name": p.first_name.strip(),
                "last_name": p.last_name.strip(),
                "full_name": f"{p.first_name.strip()} {p.last_name.strip()}",
                "team": p.team.strip(),
                "role": p.role,
                "active": True,
                "created_at": now,
            })
        if docs:
            await db.sal_players.insert_many(docs)
        return {"inserted": len(docs), "total": await db.sal_players.count_documents({})}

    @router.post("/players/import-pdf")
    async def import_players_pdf(
        file: UploadFile = File(...),
        dry_run: bool = True,
        replace_all: bool = False,
        user: dict = Depends(require_admin),
    ):
        """Upload a "Listone Fantacalcio" PDF and import players.

        - ``dry_run=true`` (default) → returns a preview without writing to DB
        - ``dry_run=false`` → actually imports (use ``replace_all=true`` to wipe
          the existing roster first)
        """
        if not file.filename or not file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Serve un file .pdf")
        raw = await file.read()
        if len(raw) > 20 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="PDF troppo grande (max 20MB)")
        try:
            extracted = _parse_listone_pdf(raw)
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("PDF parse error")
            raise HTTPException(status_code=400, detail=f"Errore nell'analisi del PDF: {e}")

        if not extracted:
            raise HTTPException(status_code=400, detail="Nessun giocatore riconosciuto nel PDF. Verifica il formato.")

        # Team distribution helps the admin sanity-check the extraction
        by_team: Dict[str, int] = {}
        by_role: Dict[str, int] = {}
        for p in extracted:
            by_team[p["team"]] = by_team.get(p["team"], 0) + 1
            by_role[p["role"]] = by_role.get(p["role"], 0) + 1

        result: Dict[str, Any] = {
            "extracted": len(extracted),
            "by_team": dict(sorted(by_team.items())),
            "by_role": dict(sorted(by_role.items())),
            "sample": extracted[:15],
            "dry_run": dry_run,
        }

        if dry_run:
            return result

        # Actually import
        if replace_all:
            await db.sal_players.delete_many({})
        now = _now()
        docs = []
        for p in extracted:
            docs.append({
                "id": str(uuid.uuid4()),
                "fanta_id": p["fanta_id"],
                "first_name": p["first_name"],
                "last_name": p["last_name"],
                "full_name": (p["first_name"] + " " + p["last_name"]).strip(),
                "team": p["team"],
                "role": p["role"],
                "role_mantra": p.get("role_mantra"),
                "price_current": p.get("price_current"),
                "price_initial": p.get("price_initial"),
                "active": True,
                "created_at": now,
            })
        await db.sal_players.insert_many(docs)
        result["inserted"] = len(docs)
        result["total"] = await db.sal_players.count_documents({})
        return result

    @router.get("/players")
    async def list_players(
        q: Optional[str] = Query(default=None, min_length=1, max_length=40),
        team: Optional[str] = None,
        role: Optional[str] = Query(default=None, pattern=r"^(P|D|C|A)$"),
        limit: int = Query(default=50, ge=1, le=1000),
        user: dict = Depends(current_user),
    ):
        filt: Dict[str, Any] = {"active": True}
        if team:
            filt["team"] = {"$regex": f"^{team}$", "$options": "i"}
        if role:
            filt["role"] = role
        if q:
            filt["full_name"] = {"$regex": q, "$options": "i"}
        cursor = db.sal_players.find(filt, {"_id": 0}).sort("full_name", 1).limit(limit)
        return [_player_dict(p) async for p in cursor]

    @router.get("/players/teams")
    async def list_teams(user: dict = Depends(current_user)):
        teams = await db.sal_players.distinct("team", {"active": True})
        return sorted([t for t in teams if t])

    # --- Tournaments ----------------------------------------------------

    @router.post("/tournaments")
    async def create_tournament(data: TournamentCreate, user: dict = Depends(require_admin)):
        # Generate a unique code (checked against BOTH tournaments' legacy field
        # AND the sal_invites collection).
        for _ in range(20):
            code = _gen_code()
            existing_t = await db.sal_tournaments.find_one({"invite_code": code})
            existing_inv = await db.sal_invites.find_one({"code": code})
            if not existing_t and not existing_inv:
                break
        else:
            raise HTTPException(status_code=500, detail="Impossibile generare un codice univoco")
        now = _now()
        tid = str(uuid.uuid4())
        doc = {
            "id": tid,
            "name": data.name.strip(),
            "admin_user_id": user["id"],
            "game": "scoreandlive",
            "status": "open",
            "initial_lives": data.initial_lives,
            "current_matchday_number": None,
            "created_at": now,
            "invite_code": code,  # legacy field: initial code (also stored in sal_invites)
            "winner_user_id": None,
            "blocked_teams_by_user": {},
        }
        await db.sal_tournaments.insert_one(doc)
        await db.sal_participants.insert_one({
            "tournament_id": tid,
            "user_id": user["id"],
            "nickname": display_name(user),
            "lives_remaining": data.initial_lives,
            "eliminated_at_matchday": None,
            "joined_at": now,
        })
        # Create the first single-use invite (mirrors TheBestTiket rooms).
        await db.sal_invites.insert_one({
            "id": str(uuid.uuid4()),
            "tournament_id": tid,
            "code": code,
            "used_by_user_id": None,
            "used_at": None,
            "created_at": now,
            "created_by": user["id"],
            "revoked_at": None,
        })
        return await _tournament_dict(doc, user)

    @router.get("/tournaments")
    async def list_tournaments(user: dict = Depends(current_user)):
        if user["role"] == "admin":
            cursor = db.sal_tournaments.find({}, {"_id": 0}).sort("created_at", -1)
        else:
            joined = [p["tournament_id"] async for p in db.sal_participants.find(
                {"user_id": user["id"]}, {"tournament_id": 1, "_id": 0})]
            cursor = db.sal_tournaments.find({"id": {"$in": joined}}, {"_id": 0}).sort("created_at", -1)
        return [await _tournament_dict(t, user) async for t in cursor]

    @router.get("/tournaments/{tournament_id}")
    async def get_tournament(tournament_id: str, user: dict = Depends(current_user)):
        t = await _get_tournament(tournament_id)
        participants: List[dict] = []
        async for p in db.sal_participants.find({"tournament_id": tournament_id}, {"_id": 0}):
            participants.append({
                "user_id": p["user_id"],
                "nickname": p["nickname"],
                "lives_remaining": p["lives_remaining"],
                "eliminated_at_matchday": p.get("eliminated_at_matchday"),
                "is_me": p["user_id"] == user["id"],
            })
        participants.sort(key=lambda x: (
            x["eliminated_at_matchday"] is not None,
            -(x["lives_remaining"] or 0),
            x["nickname"].lower(),
        ))
        matchdays: List[dict] = []
        async for md in db.sal_matchdays.find({"tournament_id": tournament_id}, {"_id": 0}).sort("matchday_number", 1):
            matchdays.append({
                "id": md["id"],
                "matchday_number": md["matchday_number"],
                "status": md["status"],
                "fixtures_count": sum(1 for f in md.get("fixtures", []) if not f.get("postponed_before")),
            })
        return {
            **await _tournament_dict(t, user),
            "participants": participants,
            "matchdays": matchdays,
            "my_blocked_teams": t.get("blocked_teams_by_user", {}).get(user["id"], []),
        }

    @router.get("/tournaments/by-code/{invite_code}")
    async def preview_tournament(invite_code: str):
        """Public preview by invite code. Rejects used or revoked codes so the
        UI can distinguish "wrong code" from "already used" like TheBestTiket."""
        code = invite_code.upper().strip()
        inv = await db.sal_invites.find_one({"code": code})
        if not inv:
            raise HTTPException(status_code=404, detail="Codice invito non valido")
        if inv.get("revoked_at"):
            raise HTTPException(status_code=410, detail="Codice invito revocato")
        if inv.get("used_by_user_id"):
            raise HTTPException(status_code=410, detail="Codice invito già utilizzato")
        t = await db.sal_tournaments.find_one({"id": inv["tournament_id"]}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Torneo non trovato")
        return {
            "id": t["id"], "name": t["name"], "status": t["status"],
            "invite_code": code, "game": "scoreandlive",
        }

    # -------- Single-use invite endpoints (admin only) --------

    @router.get("/tournaments/{tournament_id}/invites")
    async def list_invites(tournament_id: str, user: dict = Depends(current_user)):
        await _require_tournament_admin(tournament_id, user)
        invites = [inv async for inv in db.sal_invites.find(
            {"tournament_id": tournament_id}, {"_id": 0}
        ).sort("created_at", -1)]
        return [await _invite_dict(i) for i in invites]

    @router.post("/tournaments/{tournament_id}/invites")
    async def create_invite(tournament_id: str, user: dict = Depends(current_user)):
        await _require_tournament_admin(tournament_id, user)
        for _ in range(20):
            code = _gen_code()
            existing_t = await db.sal_tournaments.find_one({"invite_code": code})
            existing_inv = await db.sal_invites.find_one({"code": code})
            if not existing_t and not existing_inv:
                break
        else:
            raise HTTPException(status_code=500, detail="Impossibile generare un codice univoco, riprova")
        now = _now()
        doc = {
            "id": str(uuid.uuid4()),
            "tournament_id": tournament_id,
            "code": code,
            "used_by_user_id": None,
            "used_at": None,
            "created_at": now,
            "created_by": user["id"],
            "revoked_at": None,
        }
        await db.sal_invites.insert_one(doc)
        return await _invite_dict(doc)

    @router.delete("/tournaments/{tournament_id}/invites/{invite_id}")
    async def revoke_invite(tournament_id: str, invite_id: str, user: dict = Depends(current_user)):
        await _require_tournament_admin(tournament_id, user)
        inv = await db.sal_invites.find_one({"id": invite_id, "tournament_id": tournament_id}, {"_id": 0})
        if not inv:
            raise HTTPException(status_code=404, detail="Invito non trovato")
        if inv.get("used_by_user_id"):
            raise HTTPException(status_code=400, detail="Impossibile revocare: invito già utilizzato")
        if inv.get("revoked_at"):
            return await _invite_dict(inv)
        now = _now()
        await db.sal_invites.update_one({"id": invite_id}, {"$set": {"revoked_at": now}})
        inv["revoked_at"] = now
        return await _invite_dict(inv)

    @router.post("/tournaments/{tournament_id}/join")
    async def join_tournament(tournament_id: str, data: InviteRedeem, user: dict = Depends(current_user)):
        code = data.invite_code.upper().strip()
        # Atomically claim the invite — race-safe under concurrent joins.
        now = _now()
        claimed = await db.sal_invites.find_one_and_update(
            {"code": code, "tournament_id": tournament_id,
             "used_by_user_id": None, "revoked_at": None},
            {"$set": {"used_by_user_id": user["id"], "used_at": now}},
            return_document=ReturnDocument.AFTER,
        )
        if not claimed:
            # Distinguish "wrong code / wrong tournament" from "already used".
            inv = await db.sal_invites.find_one({"code": code})
            if not inv or inv.get("tournament_id") != tournament_id:
                raise HTTPException(status_code=400, detail="Codice invito non valido per questo torneo")
            if inv.get("revoked_at"):
                raise HTTPException(status_code=410, detail="Codice invito revocato")
            if inv.get("used_by_user_id") == user["id"]:
                # Idempotence: same user retrying → allow entry.
                t = await _get_tournament(tournament_id)
                return await _tournament_dict(t, user)
            raise HTTPException(status_code=410, detail="Codice invito già utilizzato")

        t = await _get_tournament(tournament_id)
        if t["status"] not in ("open",):
            # Roll back the claim if the tournament is closed.
            await db.sal_invites.update_one(
                {"id": claimed["id"]},
                {"$set": {"used_by_user_id": None, "used_at": None}},
            )
            raise HTTPException(status_code=400, detail="Il torneo non accetta più iscrizioni")

        existing = await _participant(tournament_id, user["id"])
        if not existing:
            await db.sal_participants.insert_one({
                "tournament_id": tournament_id,
                "user_id": user["id"],
                "nickname": display_name(user),
                "lives_remaining": t["initial_lives"],
                "eliminated_at_matchday": None,
                "joined_at": now,
            })
        return await _tournament_dict(t, user)

    @router.delete("/tournaments/{tournament_id}")
    async def delete_tournament(tournament_id: str, user: dict = Depends(require_admin)):
        await _require_tournament_admin(tournament_id, user)
        await db.sal_tournaments.delete_one({"id": tournament_id})
        await db.sal_participants.delete_many({"tournament_id": tournament_id})
        await db.sal_matchdays.delete_many({"tournament_id": tournament_id})
        await db.sal_picks.delete_many({"tournament_id": tournament_id})
        return {"ok": True}

    # --- Matchdays ------------------------------------------------------

    @router.post("/tournaments/{tournament_id}/matchdays")
    async def create_matchday(tournament_id: str, data: MatchdayCreate, user: dict = Depends(require_admin)):
        await _require_tournament_admin(tournament_id, user)
        existing = await db.sal_matchdays.find_one({
            "tournament_id": tournament_id,
            "matchday_number": data.matchday_number,
        })
        if existing:
            raise HTTPException(status_code=400, detail="Giornata già creata")

        # If no fixtures were provided, load them from the season calendar.
        # This lets the admin upload the full 380-fixture season once and then
        # have each matchday auto-populated with its 10 fixtures.
        provided = list(data.fixtures or [])
        if not provided:
            cal_rows = [r async for r in db.sal_calendar.find(
                {"matchday": data.matchday_number}, {"_id": 0}
            ).sort("home_team", 1)]
            if not cal_rows:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Nessuna fixture nel calendario per la giornata "
                        f"{data.matchday_number}. Carica il calendario stagionale "
                        f"da /sal/calendar/import o passa 'fixtures' esplicite."
                    ),
                )
            provided = [
                MatchdayFixtureIn(home_team=r["home_team"], away_team=r["away_team"])
                for r in cal_rows
            ]

        md_id = str(uuid.uuid4())
        fixtures = []
        for i, fx in enumerate(provided):
            fixtures.append({
                "idx": i,
                "home_team": fx.home_team.strip(),
                "away_team": fx.away_team.strip(),
                "postponed_before": bool(getattr(fx, "postponed", False)),
                "postponed_during": False,
            })
        doc = {
            "id": md_id,
            "tournament_id": tournament_id,
            "matchday_number": data.matchday_number,
            "fixtures": fixtures,
            "scorers": [],
            "status": "open",
            "created_at": _now(),
            "settled_at": None,
        }
        await db.sal_matchdays.insert_one(doc)
        await db.sal_tournaments.update_one(
            {"id": tournament_id},
            {"$set": {"current_matchday_number": data.matchday_number, "status": "running"}},
        )
        return {"id": md_id, **{k: doc[k] for k in ("matchday_number", "fixtures", "status")}}

    @router.patch("/tournaments/{tournament_id}/matchdays/{matchday_id}/fixtures/{idx}")
    async def update_fixture(
        tournament_id: str, matchday_id: str, idx: int,
        data: dict, user: dict = Depends(require_admin),
    ):
        """Edit a single fixture (admin only). Useful for postponements: set
        ``postponed_before=True`` or replace home/away team names.

        Body: ``{"home_team"?: str, "away_team"?: str, "postponed_before"?: bool}``
        """
        await _require_tournament_admin(tournament_id, user)
        md = await _get_matchday(matchday_id)
        if md["tournament_id"] != tournament_id:
            raise HTTPException(status_code=404, detail="Giornata non trovata")
        if md["status"] != "open":
            raise HTTPException(status_code=400, detail="Giornata già chiusa, non modificabile")

        patch: Dict[str, Any] = {}
        if "home_team" in data and isinstance(data["home_team"], str):
            patch[f"fixtures.{idx}.home_team"] = data["home_team"].strip()
        if "away_team" in data and isinstance(data["away_team"], str):
            patch[f"fixtures.{idx}.away_team"] = data["away_team"].strip()
        if "postponed_before" in data:
            patch[f"fixtures.{idx}.postponed_before"] = bool(data["postponed_before"])
        if not patch:
            raise HTTPException(status_code=400, detail="Nessun campo da modificare")
        # ensure idx exists
        if idx < 0 or idx >= len(md["fixtures"]):
            raise HTTPException(status_code=400, detail="Indice fixture non valido")
        await db.sal_matchdays.update_one({"id": matchday_id}, {"$set": patch})
        return await _get_matchday(matchday_id)

    @router.delete("/tournaments/{tournament_id}/matchdays/{matchday_id}/fixtures/{idx}")
    async def delete_fixture(
        tournament_id: str, matchday_id: str, idx: int,
        user: dict = Depends(require_admin),
    ):
        """Remove a single fixture (admin only). Renumbers remaining indices."""
        await _require_tournament_admin(tournament_id, user)
        md = await _get_matchday(matchday_id)
        if md["tournament_id"] != tournament_id:
            raise HTTPException(status_code=404, detail="Giornata non trovata")
        if md["status"] != "open":
            raise HTTPException(status_code=400, detail="Giornata già chiusa, non modificabile")
        if idx < 0 or idx >= len(md["fixtures"]):
            raise HTTPException(status_code=400, detail="Indice fixture non valido")
        new_fixtures = [f for i, f in enumerate(md["fixtures"]) if i != idx]
        for i, f in enumerate(new_fixtures):
            f["idx"] = i
        await db.sal_matchdays.update_one(
            {"id": matchday_id}, {"$set": {"fixtures": new_fixtures}}
        )
        return await _get_matchday(matchday_id)

    # --- Season calendar (admin only) -----------------------------------

    @router.post("/calendar/import")
    async def import_calendar(data: CalendarImportIn, user: dict = Depends(require_admin)):
        """Bulk-import the entire Serie A calendar for a season.

        Typical payload: 380 fixtures (38 matchdays × 10 games each).
        If ``replace=True`` (default), any previous rows for the same season
        are removed before the insert. Idempotent per (season, matchday,
        home_team) triplet.
        """
        if not data.fixtures:
            raise HTTPException(status_code=400, detail="Elenco fixtures vuoto")
        if data.replace:
            await db.sal_calendar.delete_many({"season": data.season})
        now = _now()
        # Basic dedupe within the payload
        seen = set()
        docs = []
        for fx in data.fixtures:
            key = (data.season, fx.matchday, fx.home_team.strip().lower())
            if key in seen:
                continue
            seen.add(key)
            docs.append({
                "id": str(uuid.uuid4()),
                "season": data.season,
                "matchday": fx.matchday,
                "home_team": fx.home_team.strip(),
                "away_team": fx.away_team.strip(),
                "kickoff_iso": fx.kickoff_iso,
                "imported_at": now,
            })
        if docs:
            await db.sal_calendar.insert_many(docs)
        by_md: Dict[int, int] = {}
        for d in docs:
            by_md[d["matchday"]] = by_md.get(d["matchday"], 0) + 1
        return {
            "season": data.season,
            "inserted": len(docs),
            "matchdays": sorted(by_md.keys()),
            "counts_by_matchday": by_md,
        }

    @router.get("/calendar")
    async def list_calendar(
        season: str = "2025-26",
        matchday: Optional[int] = None,
        user: dict = Depends(current_user),
    ):
        q: Dict[str, Any] = {"season": season}
        if matchday is not None:
            q["matchday"] = matchday
        rows = [r async for r in db.sal_calendar.find(q, {"_id": 0})
                .sort([("matchday", 1), ("home_team", 1)])]
        return {"season": season, "count": len(rows), "fixtures": rows}

    @router.delete("/calendar")
    async def clear_calendar(season: str = "2025-26", user: dict = Depends(require_admin)):
        r = await db.sal_calendar.delete_many({"season": season})
        return {"season": season, "deleted": r.deleted_count}

    @router.get("/tournaments/{tournament_id}/matchdays/{matchday_id}")
    async def get_matchday(tournament_id: str, matchday_id: str, user: dict = Depends(current_user)):
        md = await _get_matchday(matchday_id)
        if md["tournament_id"] != tournament_id:
            raise HTTPException(status_code=404, detail="Giornata non trovata")
        my_picks = await db.sal_picks.find_one(
            {"tournament_id": tournament_id, "matchday_id": matchday_id, "user_id": user["id"]},
            {"_id": 0},
        )
        return {**md, "my_picks": my_picks}

    # --- Picks ----------------------------------------------------------

    @router.post("/tournaments/{tournament_id}/matchdays/{matchday_id}/picks")
    async def submit_picks(
        tournament_id: str, matchday_id: str, data: PicksSubmit,
        user: dict = Depends(current_user),
    ):
        part = await _participant(tournament_id, user["id"])
        if not part:
            raise HTTPException(status_code=403, detail="Non sei iscritto a questo torneo")
        if part.get("eliminated_at_matchday") is not None:
            raise HTTPException(status_code=400, detail="Sei stato eliminato dal torneo")
        md = await _get_matchday(matchday_id)
        if md["tournament_id"] != tournament_id:
            raise HTTPException(status_code=404, detail="Giornata non trovata")
        if md["status"] != "open":
            raise HTTPException(status_code=400, detail="I pick per questa giornata sono chiusi")

        playable = [f for f in md["fixtures"] if not f.get("postponed_before")]
        playable_ids = {f["idx"] for f in playable}

        seen_ids: set[int] = set()
        for p in data.picks:
            if p.fixture_idx not in playable_ids:
                raise HTTPException(status_code=400, detail=f"Partita {p.fixture_idx} non giocabile")
            if p.fixture_idx in seen_ids:
                raise HTTPException(status_code=400, detail="Pick duplicato per la stessa partita")
            seen_ids.add(p.fixture_idx)
        missing = playable_ids - seen_ids
        if missing:
            raise HTTPException(status_code=400, detail=f"Manca il pick per {len(missing)} partita/e")

        t = await _get_tournament(tournament_id)
        blocked = {_norm_team(x) for x in t.get("blocked_teams_by_user", {}).get(user["id"], [])}

        pick_docs = []
        for p in data.picks:
            fx = next(f for f in md["fixtures"] if f["idx"] == p.fixture_idx)
            player = await db.sal_players.find_one({"id": p.player_id}, {"_id": 0})
            if not player:
                raise HTTPException(status_code=400, detail=f"Giocatore {p.player_id} non trovato")
            home = _norm_team(fx["home_team"])
            away = _norm_team(fx["away_team"])
            p_team = _norm_team(player["team"])
            if p_team not in (home, away):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"{player.get('full_name')} gioca nel {player.get('team')}, "
                        f"che non fa parte di {fx['home_team']} - {fx['away_team']}"
                    ),
                )
            # Option B — team-block rule with deadlock exception:
            #   * if BOTH teams of this fixture are already blocked for the user,
            #     the pick is admitted regardless (deroga di stallo).
            #   * otherwise, reject the pick only if the chosen player's own
            #     team is blocked (the opposite team is fine).
            both_blocked = home in blocked and away in blocked
            if not both_blocked and p_team in blocked:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"La squadra {player.get('team')} è bloccata per te. "
                        f"Scegli un giocatore del {fx['away_team'] if p_team == home else fx['home_team']}."
                    ),
                )
            pick_docs.append({
                "fixture_idx": p.fixture_idx,
                "player_id": p.player_id,
                "player_name": player.get("full_name"),
                "team": player.get("team"),
                # informational — clients can badge these picks in review UIs
                "deadlock_override": both_blocked,
            })

        await db.sal_picks.update_one(
            {"tournament_id": tournament_id, "matchday_id": matchday_id, "user_id": user["id"]},
            {"$set": {
                "tournament_id": tournament_id,
                "matchday_id": matchday_id,
                "user_id": user["id"],
                "nickname": display_name(user),
                "picks": pick_docs,
                "submitted_at": _now(),
            }},
            upsert=True,
        )
        return {"ok": True, "picks": pick_docs}

    # --- Settlement -----------------------------------------------------

    @router.post("/tournaments/{tournament_id}/matchdays/{matchday_id}/settle")
    async def settle_matchday(
        tournament_id: str, matchday_id: str, data: ResultsConfirm,
        user: dict = Depends(require_admin),
    ):
        t = await _require_tournament_admin(tournament_id, user)
        md = await _get_matchday(matchday_id)
        if md["tournament_id"] != tournament_id:
            raise HTTPException(status_code=404, detail="Giornata non trovata")
        if md["status"] == "settled":
            raise HTTPException(status_code=400, detail="Giornata già chiusa")

        playable = {f["idx"] for f in md["fixtures"] if not f.get("postponed_before")}
        postponed_during = {i for i in data.postponed_during if i in playable}

        scorers_by_fixture: Dict[int, List[str]] = {}
        for s in data.scorers:
            if s.fixture_idx not in playable:
                raise HTTPException(status_code=400, detail=f"Partita {s.fixture_idx} non giocabile")
            if s.fixture_idx in postponed_during:
                raise HTTPException(
                    status_code=400,
                    detail=f"La partita {s.fixture_idx} è stata rinviata durante la giornata",
                )
            player = await db.sal_players.find_one({"id": s.player_id}, {"_id": 0})
            if not player:
                raise HTTPException(status_code=400, detail=f"Giocatore {s.player_id} non trovato")
            scorers_by_fixture.setdefault(s.fixture_idx, []).append(s.player_id)

        global_blocked_teams: set[str] = set()
        for fx in md["fixtures"]:
            if fx["idx"] in postponed_during:
                global_blocked_teams.add(fx["home_team"])
                global_blocked_teams.add(fx["away_team"])

        blocked_by_user = dict(t.get("blocked_teams_by_user", {}))

        picks_cursor = db.sal_picks.find(
            {"tournament_id": tournament_id, "matchday_id": matchday_id}, {"_id": 0}
        )
        async for pk in picks_cursor:
            user_id = pk["user_id"]
            part = await _participant(tournament_id, user_id)
            if not part or part.get("eliminated_at_matchday") is not None:
                continue
            lives_lost = 0
            hits: List[dict] = []
            misses: List[dict] = []
            for p in pk["picks"]:
                fidx = p["fixture_idx"]
                if fidx in postponed_during:
                    continue  # Life saved
                scorer_ids = scorers_by_fixture.get(fidx, [])
                if p["player_id"] in scorer_ids:
                    hits.append(p)
                    blocked_set = set(blocked_by_user.get(user_id, []))
                    blocked_set.add(p["team"])
                    blocked_by_user[user_id] = sorted(blocked_set)
                else:
                    misses.append(p)
                    lives_lost += 1
            if global_blocked_teams:
                blocked_set = set(blocked_by_user.get(user_id, []))
                blocked_set.update(global_blocked_teams)
                blocked_by_user[user_id] = sorted(blocked_set)
            new_lives = max(0, part["lives_remaining"] - lives_lost)
            set_fields = {"lives_remaining": new_lives}
            if new_lives == 0 and part.get("eliminated_at_matchday") is None:
                set_fields["eliminated_at_matchday"] = md["matchday_number"]
            await db.sal_participants.update_one(
                {"tournament_id": tournament_id, "user_id": user_id},
                {"$set": set_fields},
            )
            await db.sal_picks.update_one(
                {"tournament_id": tournament_id, "matchday_id": matchday_id, "user_id": user_id},
                {"$set": {"hits": hits, "misses": misses, "lives_lost": lives_lost}},
            )

        await db.sal_tournaments.update_one(
            {"id": tournament_id},
            {"$set": {"blocked_teams_by_user": blocked_by_user}},
        )
        scorers_list = [
            {"fixture_idx": fidx, "player_id": pid}
            for fidx, pids in scorers_by_fixture.items()
            for pid in pids
        ]
        fixtures_updated = []
        for fx in md["fixtures"]:
            f = dict(fx)
            if fx["idx"] in postponed_during:
                f["postponed_during"] = True
            fixtures_updated.append(f)
        await db.sal_matchdays.update_one(
            {"id": matchday_id},
            {"$set": {
                "scorers": scorers_list,
                "fixtures": fixtures_updated,
                "status": "settled",
                "settled_at": _now(),
            }},
        )
        alive = [p async for p in db.sal_participants.find(
            {"tournament_id": tournament_id, "eliminated_at_matchday": None}, {"_id": 0}
        )]
        if len(alive) == 1:
            await db.sal_tournaments.update_one(
                {"id": tournament_id},
                {"$set": {"status": "finished", "winner_user_id": alive[0]["user_id"]}},
            )
        return {"ok": True, "settled": True, "alive_count": len(alive)}

    return router


async def ensure_indexes(db) -> None:
    """Create MongoDB indexes for the ScoreAndLive collections."""
    await db.sal_players.create_index([("full_name", 1)])
    await db.sal_players.create_index("team")
    await db.sal_tournaments.create_index("admin_user_id")
    await db.sal_tournaments.create_index("invite_code", unique=True, sparse=True)
    await db.sal_matchdays.create_index([("tournament_id", 1), ("matchday_number", 1)], unique=True)
    await db.sal_picks.create_index(
        [("tournament_id", 1), ("matchday_id", 1), ("user_id", 1)], unique=True
    )
    await db.sal_participants.create_index(
        [("tournament_id", 1), ("user_id", 1)], unique=True
    )
    # Single-use invites (mirrors the TheBestTiket rooms model).
    await db.sal_invites.create_index("code", unique=True)
    await db.sal_invites.create_index(
        [("tournament_id", 1), ("used_by_user_id", 1)]
    )
    # Season calendar
    await db.sal_calendar.create_index([("season", 1), ("matchday", 1)])
    await db.sal_calendar.create_index(
        [("season", 1), ("matchday", 1), ("home_team", 1)], unique=True
    )

    # Backfill: for legacy tournaments that carry `invite_code` on the document
    # but have no matching invite record, create the corresponding single-use
    # invite so existing invite links keep working.
    now = datetime.now(timezone.utc).isoformat()
    async for t in db.sal_tournaments.find(
        {"invite_code": {"$exists": True}},
        {"id": 1, "invite_code": 1, "admin_user_id": 1, "created_at": 1, "_id": 0},
    ):
        existing = await db.sal_invites.find_one({"code": t["invite_code"]})
        if not existing:
            # If the tournament already has participants beyond the admin, we
            # assume the initial code was already redeemed (legacy multi-use
            # behaviour). Mark it as used-by-admin so it can't be re-consumed.
            used_by = None
            used_at = None
            n_participants = await db.sal_participants.count_documents({"tournament_id": t["id"]})
            if n_participants > 1:
                used_by = t.get("admin_user_id")
                used_at = t.get("created_at") or now
            await db.sal_invites.insert_one({
                "id": str(uuid.uuid4()),
                "tournament_id": t["id"],
                "code": t["invite_code"],
                "used_by_user_id": used_by,
                "used_at": used_at,
                "created_at": t.get("created_at") or now,
                "created_by": t.get("admin_user_id"),
                "revoked_at": None,
            })
