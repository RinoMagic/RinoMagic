"""Surviva 2.0 — the fourth mini-game inside the RinoMagic umbrella.

Elimination tournament based on 1X2 predictions. Each matchday a player
picks **one** fixture and its outcome (1 / X / 2). A wrong prediction costs
one life. When a user has zero lives left they are eliminated. Once a
player has correctly guessed a (team, outcome) pair (e.g. "Inter → Vittoria"),
that combination becomes permanently unavailable for future matchdays — no
matter whether Inter plays at home or away.

Data model (all collections prefixed with ``sv_``):

* ``sv_tournaments``    — one running elimination tournament
* ``sv_invites``        — one-shot invite codes to join
* ``sv_participants``   — per-tournament state (lives, blocked signs, ...)
* ``sv_matchdays``      — a matchday inside a tournament
* ``sv_picks``          — the pick a player submits for a matchday (one per user)
* ``sal_calendar``      — shared with ScoreAndLive (season fixtures)

Cross-game features (also consumed by ScoreAndLive):
* Riassunto Giornata: pre-kickoff aggregated view, post-kickoff detailed view.
"""
from __future__ import annotations

import uuid
import string
import random
import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any, Callable, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger("surviva")

DEFAULT_LIVES = 3

# =========================================================================
# Blocked-sign engine
# =========================================================================
# The domain outcome of a fixture pick is derived from the perspective of
# each team:
#   pick "1" (home wins):  home → win,  away → lose
#   pick "X" (draw):       home → draw, away → draw
#   pick "2" (away wins):  home → lose, away → win
# The three outcomes are represented as short strings for stable storage:
#   "W" = vittoria    "D" = pareggio    "L" = sconfitta
_OUTCOME_HOME = {"1": "W", "X": "D", "2": "L"}
_OUTCOME_AWAY = {"1": "L", "X": "D", "2": "W"}


def _team_outcomes_for_pick(pick: str) -> Tuple[str, str]:
    """Return (home_outcome, away_outcome) for a 1/X/2 pick."""
    return _OUTCOME_HOME[pick], _OUTCOME_AWAY[pick]


def _pick_is_blocked(
    pick: str,
    home_team: str,
    away_team: str,
    blocked_signs: List[dict],
) -> Optional[dict]:
    """Return the offending blocked-sign entry if *pick* uses a blocked
    (team, outcome) pair, otherwise ``None``.

    ``blocked_signs`` is the ``participant.blocked_signs`` list, where each
    entry is ``{"team": str, "outcome": "W"|"D"|"L", "matchday": int}``.
    """
    h_out, a_out = _team_outcomes_for_pick(pick)
    for entry in blocked_signs:
        if entry.get("team") == home_team and entry.get("outcome") == h_out:
            return entry
        if entry.get("team") == away_team and entry.get("outcome") == a_out:
            return entry
    return None


def _pick_correct(pick: str, home_score: int, away_score: int) -> bool:
    """Return True if *pick* matches the final score of the fixture."""
    if pick == "1":
        return home_score > away_score
    if pick == "2":
        return home_score < away_score
    if pick == "X":
        return home_score == away_score
    return False


# =========================================================================
# Pydantic models
# =========================================================================

class TournamentCreate(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    season: str = Field(default="2026-27", max_length=10)
    initial_lives: int = Field(default=DEFAULT_LIVES, ge=1, le=10)


class JoinIn(BaseModel):
    invite_code: str

    @field_validator("invite_code")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.strip().upper()


class PickSubmit(BaseModel):
    """A single-pick submission for a matchday (Surviva 2.0 = 1 pick/matchday)."""
    home_team: str
    away_team: str
    pick: str = Field(pattern=r"^[1X2]$")


class MatchdaySettle(BaseModel):
    """Settle a matchday by providing per-fixture results.

    Postponed matches can be marked with ``postponed=True`` — they will neither
    cost lives nor grant blocked signs, and the pick remains pending until the
    admin re-settles the matchday with the updated results.
    """
    results: List[dict] = Field(default_factory=list)


# =========================================================================
# Indexes + router factory
# =========================================================================

async def ensure_indexes(db) -> None:
    try:
        await db.sv_tournaments.create_index("id", unique=True)
        await db.sv_tournaments.create_index("invite_code", unique=True)
        await db.sv_invites.create_index("code", unique=True)
        await db.sv_invites.create_index([("tournament_id", 1), ("used_by_user_id", 1)])
        await db.sv_participants.create_index(
            [("tournament_id", 1), ("user_id", 1)], unique=True,
        )
        await db.sv_matchdays.create_index(
            [("tournament_id", 1), ("matchday", 1)], unique=True,
        )
        await db.sv_picks.create_index(
            [("tournament_id", 1), ("matchday_id", 1), ("user_id", 1)],
            unique=True,
        )
        await db.sv_picks.create_index([("tournament_id", 1), ("user_id", 1)])
    except Exception:
        logger.exception("Failed to create Surviva indexes")


def build_router(
    db,
    current_user: Callable,
    require_admin: Callable,
    display_name: Callable,
) -> APIRouter:
    router = APIRouter(prefix="/sv")

    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _gen_code(length: int = 6) -> str:
        return "".join(random.choices(string.ascii_uppercase + string.digits, k=length))

    async def _get_tournament(tid: str) -> dict:
        t = await db.sv_tournaments.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Torneo non trovato")
        return t

    async def _get_participant(tid: str, uid: str) -> Optional[dict]:
        return await db.sv_participants.find_one(
            {"tournament_id": tid, "user_id": uid}, {"_id": 0},
        )

    async def _require_participant(tid: str, uid: str) -> dict:
        p = await _get_participant(tid, uid)
        if not p:
            raise HTTPException(status_code=403, detail="Non sei iscritto a questo torneo")
        return p

    async def _require_tournament_admin(tid: str, user: dict) -> dict:
        t = await _get_tournament(tid)
        if user["role"] != "admin" and user["id"] != t.get("admin_user_id"):
            raise HTTPException(status_code=403, detail="Solo l'admin del torneo")
        return t

    async def _fixtures_for_matchday(season: str, matchday: int) -> List[dict]:
        """Read the fixtures list from the shared ``sal_calendar`` collection."""
        cursor = db.sal_calendar.find(
            {"season": season, "matchday": matchday},
            {"_id": 0, "home_team": 1, "away_team": 1, "kickoff_iso": 1},
        )
        return [f async for f in cursor]

    async def _auto_populate_matchdays(tid: str, season: str) -> int:
        """Create ``sv_matchdays`` docs for every matchday available in the
        season calendar. Idempotent — existing matchdays are skipped.
        Returns the number of matchdays created.
        """
        # Distinct matchdays available for this season
        mds = await db.sal_calendar.distinct("matchday", {"season": season})
        created = 0
        for md in sorted(int(x) for x in mds):
            existing = await db.sv_matchdays.find_one(
                {"tournament_id": tid, "matchday": md}, {"id": 1, "_id": 0},
            )
            if existing:
                continue
            fixtures = await _fixtures_for_matchday(season, md)
            first_kick = None
            for f in fixtures:
                k = f.get("kickoff_iso")
                if k and (first_kick is None or k < first_kick):
                    first_kick = k
            await db.sv_matchdays.insert_one({
                "id": str(uuid.uuid4()),
                "tournament_id": tid,
                "matchday": md,
                "season": season,
                "status": "open",  # open → locked (after first kickoff) → settled
                "kickoff_first": first_kick,
                "fixtures": fixtures,
                "created_at": _now(),
                "settled_at": None,
            })
            created += 1
        return created

    def _blocked_dict(p: Optional[dict]) -> List[dict]:
        if not p:
            return []
        return p.get("blocked_signs") or []

    async def _tournament_dict(t: dict, viewer: Optional[dict] = None) -> dict:
        players = await db.sv_participants.count_documents({"tournament_id": t["id"]})
        alive = await db.sv_participants.count_documents(
            {"tournament_id": t["id"], "eliminated_at": None},
        )
        is_admin = bool(
            viewer and (viewer["role"] == "admin" or viewer["id"] == t.get("admin_user_id"))
        )
        joined = False
        if viewer:
            joined = bool(await _get_participant(t["id"], viewer["id"]))
        return {
            "id": t["id"],
            "name": t["name"],
            "season": t.get("season", "2026-27"),
            "status": t.get("status", "open"),
            "admin_user_id": t.get("admin_user_id"),
            "initial_lives": t.get("initial_lives", DEFAULT_LIVES),
            "current_matchday": t.get("current_matchday", 1),
            "invite_code": t.get("invite_code"),
            "created_at": t.get("created_at"),
            "finished_at": t.get("finished_at"),
            "players_total": players,
            "players_alive": alive,
            "is_admin": is_admin,
            "joined": joined,
        }

    # ------------------------------------------------------------------
    # Tournaments — CRUD + join
    # ------------------------------------------------------------------

    @router.post("/tournaments")
    async def create_tournament(
        data: TournamentCreate, user: dict = Depends(require_admin),
    ):
        # Generate unique invite code
        for _ in range(20):
            code = _gen_code()
            if not await db.sv_tournaments.find_one({"invite_code": code}) \
                    and not await db.sv_invites.find_one({"code": code}):
                break
        else:
            raise HTTPException(status_code=500, detail="Impossibile generare un codice univoco")

        tid = str(uuid.uuid4())
        now = _now()
        doc = {
            "id": tid,
            "name": data.name,
            "season": data.season,
            "status": "open",
            "admin_user_id": user["id"],
            "initial_lives": data.initial_lives,
            "current_matchday": 1,
            "invite_code": code,
            "created_at": now,
            "finished_at": None,
        }
        await db.sv_tournaments.insert_one(doc)
        # Initial single-use invite
        await db.sv_invites.insert_one({
            "id": str(uuid.uuid4()),
            "tournament_id": tid,
            "code": code,
            "used_by_user_id": None,
            "used_at": None,
            "created_at": now,
            "created_by": user["id"],
            "revoked_at": None,
        })
        # Auto-join the creating admin as participant
        await db.sv_participants.insert_one({
            "tournament_id": tid,
            "user_id": user["id"],
            "nickname": display_name(user),
            "lives_left": data.initial_lives,
            "blocked_signs": [],
            "eliminated_at": None,
            "joined_at": now,
        })
        # Auto-populate matchdays from calendar
        created = await _auto_populate_matchdays(tid, data.season)
        logger.info("Surviva tournament %s created — %d matchdays populated", tid, created)
        return await _tournament_dict(doc, user)

    @router.get("/tournaments")
    async def list_tournaments(
        user: dict = Depends(current_user),
        include_finished: bool = False,
    ):
        q: dict = {}
        if not include_finished:
            q["status"] = {"$ne": "finished"}
        cursor = db.sv_tournaments.find(q, {"_id": 0}).sort("created_at", -1)
        out = []
        async for t in cursor:
            out.append(await _tournament_dict(t, user))
        return out

    @router.get("/tournaments/history")
    async def tournaments_history(user: dict = Depends(current_user)):
        """Finished tournaments — always visible to everyone (public archive)."""
        cursor = db.sv_tournaments.find(
            {"status": "finished"}, {"_id": 0},
        ).sort("finished_at", -1)
        out = []
        async for t in cursor:
            out.append(await _tournament_dict(t, user))
        return out

    @router.get("/tournaments/{tid}")
    async def get_tournament(tid: str, user: dict = Depends(current_user)):
        t = await _get_tournament(tid)
        return await _tournament_dict(t, user)

    @router.delete("/tournaments/{tid}")
    async def delete_tournament(tid: str, user: dict = Depends(require_admin)):
        t = await _get_tournament(tid)
        _ = t
        await db.sv_tournaments.delete_one({"id": tid})
        await db.sv_invites.delete_many({"tournament_id": tid})
        await db.sv_participants.delete_many({"tournament_id": tid})
        await db.sv_matchdays.delete_many({"tournament_id": tid})
        await db.sv_picks.delete_many({"tournament_id": tid})
        return {"ok": True}

    @router.post("/tournaments/join")
    async def join_tournament(data: JoinIn, user: dict = Depends(current_user)):
        code = data.invite_code
        invite = await db.sv_invites.find_one({"code": code})
        if not invite:
            raise HTTPException(status_code=404, detail="Codice invito non valido")
        if invite.get("revoked_at"):
            raise HTTPException(status_code=410, detail="Codice invito revocato")
        if invite.get("used_by_user_id") and invite["used_by_user_id"] != user["id"]:
            raise HTTPException(status_code=410, detail="Codice invito già utilizzato")
        tid = invite["tournament_id"]
        t = await _get_tournament(tid)
        if t.get("status") == "finished":
            raise HTTPException(status_code=400, detail="Torneo già concluso")

        # Idempotent: allow re-entry by the same user
        existing = await _get_participant(tid, user["id"])
        if existing:
            return await _tournament_dict(t, user)

        # Refuse joining if the tournament is past the first matchday to
        # prevent late-joiners from having an unfair advantage.
        if int(t.get("current_matchday") or 1) > 1:
            raise HTTPException(
                status_code=400,
                detail="Torneo già iniziato: iscrizioni chiuse.",
            )

        # Claim invite + create participant
        await db.sv_invites.update_one(
            {"id": invite["id"]},
            {"$set": {"used_by_user_id": user["id"], "used_at": _now()}},
        )
        await db.sv_participants.insert_one({
            "tournament_id": tid,
            "user_id": user["id"],
            "nickname": display_name(user),
            "lives_left": t.get("initial_lives", DEFAULT_LIVES),
            "blocked_signs": [],
            "eliminated_at": None,
            "joined_at": _now(),
        })
        return await _tournament_dict(t, user)

    @router.get("/tournaments/{tid}/participants")
    async def list_participants(tid: str, user: dict = Depends(current_user)):
        await _get_tournament(tid)
        cursor = db.sv_participants.find({"tournament_id": tid}, {"_id": 0})
        rows = []
        async for p in cursor:
            rows.append({
                "user_id": p["user_id"],
                "nickname": p["nickname"],
                "lives_left": p.get("lives_left", 0),
                "eliminated_at": p.get("eliminated_at"),
                "blocked_signs": p.get("blocked_signs", []),
            })
        # Sort: alive first (by lives desc), then eliminated by date desc
        rows.sort(key=lambda r: (
            r["eliminated_at"] is not None,
            -r["lives_left"],
            r["nickname"].lower(),
        ))
        return rows

    # ------------------------------------------------------------------
    # Matchdays + picks
    # ------------------------------------------------------------------

    def _md_is_locked(md: dict) -> bool:
        """A matchday is locked for picks once the first kickoff is past."""
        k = md.get("kickoff_first")
        if not k:
            return md.get("status") in {"locked", "settled"}
        try:
            dt = datetime.fromisoformat(k.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return datetime.now(timezone.utc) >= dt
        except Exception:
            return md.get("status") in {"locked", "settled"}

    async def _matchday_dict(md: dict, viewer_id: Optional[str] = None) -> dict:
        locked = _md_is_locked(md)
        my_picks_count = 0
        if viewer_id:
            my_picks_count = await db.sv_picks.count_documents({
                "tournament_id": md["tournament_id"],
                "matchday_id": md["id"],
                "user_id": viewer_id,
            })
        return {
            "id": md["id"],
            "tournament_id": md["tournament_id"],
            "matchday": md["matchday"],
            "season": md.get("season"),
            "status": md.get("status", "open"),
            "kickoff_first": md.get("kickoff_first"),
            "fixtures": md.get("fixtures", []),
            "locked": locked,
            "settled": md.get("status") == "settled",
            "my_picks_count": my_picks_count,
        }

    @router.get("/tournaments/{tid}/matchdays")
    async def list_matchdays(tid: str, user: dict = Depends(current_user)):
        await _get_tournament(tid)
        cursor = db.sv_matchdays.find({"tournament_id": tid}, {"_id": 0}).sort("matchday", 1)
        rows = []
        async for md in cursor:
            rows.append(await _matchday_dict(md, user["id"]))
        return rows

    @router.get("/tournaments/{tid}/matchdays/current")
    async def current_matchday(tid: str, user: dict = Depends(current_user)):
        t = await _get_tournament(tid)
        md = await db.sv_matchdays.find_one({
            "tournament_id": tid,
            "matchday": t.get("current_matchday", 1),
        }, {"_id": 0})
        if not md:
            raise HTTPException(status_code=404, detail="Nessuna giornata in corso")
        return await _matchday_dict(md, user["id"])

    @router.get("/tournaments/{tid}/matchdays/{md_id}/my-pick")
    async def my_pick(tid: str, md_id: str, user: dict = Depends(current_user)):
        await _require_participant(tid, user["id"])
        p = await db.sv_picks.find_one(
            {"tournament_id": tid, "matchday_id": md_id, "user_id": user["id"]},
            {"_id": 0},
        )
        return p or {"empty": True}

    @router.get("/tournaments/{tid}/blocked-signs")
    async def my_blocked_signs(tid: str, user: dict = Depends(current_user)):
        p = await _require_participant(tid, user["id"])
        return {"blocked_signs": _blocked_dict(p), "lives_left": p.get("lives_left", 0)}

    @router.post("/tournaments/{tid}/matchdays/{md_id}/pick")
    async def submit_pick(
        tid: str, md_id: str, data: PickSubmit, user: dict = Depends(current_user),
    ):
        """Submit (or update) the caller's single pick for a matchday.

        Surviva 2.0 rule: **one** pick per matchday per player. Calling this
        endpoint again before the matchday is locked replaces the previous
        pick.
        """
        p = await _require_participant(tid, user["id"])
        if p.get("eliminated_at"):
            raise HTTPException(status_code=403, detail="Sei stato eliminato dal torneo")
        md = await db.sv_matchdays.find_one({"id": md_id, "tournament_id": tid}, {"_id": 0})
        if not md:
            raise HTTPException(status_code=404, detail="Giornata non trovata")
        if _md_is_locked(md):
            raise HTTPException(status_code=403, detail="Giornata chiusa: pronostici bloccati")

        fixtures_by_key = {
            (f["home_team"], f["away_team"]): f for f in md.get("fixtures", [])
        }
        key = (data.home_team, data.away_team)
        if key not in fixtures_by_key:
            raise HTTPException(
                status_code=400,
                detail=f"Partita non in calendario: {data.home_team} vs {data.away_team}",
            )
        blocked = _blocked_dict(p)
        blocked_by = _pick_is_blocked(data.pick, data.home_team, data.away_team, blocked)
        if blocked_by:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Segno bloccato: hai già indovinato {blocked_by['team']} → "
                    f"{blocked_by['outcome']} (giornata {blocked_by.get('matchday')})"
                ),
            )

        now = _now()
        # Enforce ONE pick per user per matchday: upsert on (t, md, user).
        await db.sv_picks.update_one(
            {"tournament_id": tid, "matchday_id": md_id, "user_id": user["id"]},
            {"$set": {
                "tournament_id": tid,
                "matchday_id": md_id,
                "matchday": md["matchday"],
                "user_id": user["id"],
                "nickname": p["nickname"],
                "home_team": data.home_team,
                "away_team": data.away_team,
                "pick": data.pick,
                "correct": None,
                "lost_life": None,
                "created_at": now,
            }},
            upsert=True,
        )
        return {"ok": True}

    # ------------------------------------------------------------------
    # Settlement + auto-progression
    # ------------------------------------------------------------------

    @router.post("/tournaments/{tid}/matchdays/{md_id}/settle")
    async def settle_matchday(
        tid: str, md_id: str, data: MatchdaySettle,
        user: dict = Depends(current_user),
    ):
        t = await _require_tournament_admin(tid, user)
        md = await db.sv_matchdays.find_one({"id": md_id, "tournament_id": tid}, {"_id": 0})
        if not md:
            raise HTTPException(status_code=404, detail="Giornata non trovata")

        # Build a lookup: (home,away) → {home_score, away_score, postponed}
        results_by_key: Dict[Tuple[str, str], dict] = {}
        for r in data.results:
            k = (r.get("home_team"), r.get("away_team"))
            if not k[0] or not k[1]:
                continue
            results_by_key[k] = r

        # Iterate through every submitted pick — mark correct/wrong,
        # deduct lives, and add blocked signs on correct picks.
        picks_cur = db.sv_picks.find({"tournament_id": tid, "matchday_id": md_id})
        stats = {"settled": 0, "correct": 0, "wrong": 0, "postponed": 0}
        # We batch participant updates in-memory to avoid concurrent races.
        pending_participant_updates: Dict[str, dict] = {}
        eliminated_now: List[str] = []

        async for pk in picks_cur:
            key = (pk["home_team"], pk["away_team"])
            res = results_by_key.get(key)
            if not res or res.get("postponed"):
                # Postponed / no data: leave pick pending
                stats["postponed"] += 1
                continue
            hs = int(res.get("home_score") or 0)
            as_ = int(res.get("away_score") or 0)
            correct = _pick_correct(pk["pick"], hs, as_)
            await db.sv_picks.update_one(
                {"_id": pk["_id"]},
                {"$set": {
                    "correct": correct,
                    "lost_life": (not correct),
                    "home_score": hs,
                    "away_score": as_,
                    "settled_at": _now(),
                }},
            )
            stats["settled"] += 1
            uid = pk["user_id"]
            state = pending_participant_updates.setdefault(uid, {"life_delta": 0, "new_blocks": []})
            if correct:
                stats["correct"] += 1
                # Add blocked signs for both teams (based on the pick semantics)
                h_out, a_out = _team_outcomes_for_pick(pk["pick"])
                state["new_blocks"].append({
                    "team": pk["home_team"], "outcome": h_out,
                    "matchday": md["matchday"],
                })
                state["new_blocks"].append({
                    "team": pk["away_team"], "outcome": a_out,
                    "matchday": md["matchday"],
                })
            else:
                stats["wrong"] += 1
                state["life_delta"] -= 1

        # Apply participant updates
        for uid, state in pending_participant_updates.items():
            p = await _get_participant(tid, uid)
            if not p:
                continue
            new_lives = max(0, int(p.get("lives_left", 0)) + state["life_delta"])
            existing = p.get("blocked_signs") or []
            existing_keys = {(b.get("team"), b.get("outcome")) for b in existing}
            for b in state["new_blocks"]:
                if (b["team"], b["outcome"]) not in existing_keys:
                    existing.append(b)
                    existing_keys.add((b["team"], b["outcome"]))
            update_set: dict = {"lives_left": new_lives, "blocked_signs": existing}
            if new_lives <= 0 and not p.get("eliminated_at"):
                update_set["eliminated_at"] = _now()
                eliminated_now.append(uid)
            await db.sv_participants.update_one(
                {"tournament_id": tid, "user_id": uid},
                {"$set": update_set},
            )

        # Mark matchday as settled and advance the tournament
        await db.sv_matchdays.update_one(
            {"id": md_id, "tournament_id": tid},
            {"$set": {"status": "settled", "settled_at": _now()}},
        )
        # Next matchday: the smallest one with matchday > current that exists.
        next_md = await db.sv_matchdays.find_one(
            {"tournament_id": tid, "matchday": {"$gt": md["matchday"]}},
            {"matchday": 1, "_id": 0},
            sort=[("matchday", 1)],
        )
        finished = next_md is None
        # A tournament also finishes when 0 or 1 players remain alive.
        alive = await db.sv_participants.count_documents(
            {"tournament_id": tid, "eliminated_at": None},
        )
        if alive <= 1:
            finished = True

        tour_patch: dict = {}
        if finished:
            tour_patch["status"] = "finished"
            tour_patch["finished_at"] = _now()
        elif next_md:
            tour_patch["current_matchday"] = int(next_md["matchday"])
        if tour_patch:
            await db.sv_tournaments.update_one({"id": tid}, {"$set": tour_patch})

        return {
            "ok": True,
            "matchday": md["matchday"],
            "stats": stats,
            "eliminated_now": eliminated_now,
            "next_matchday": None if finished else int(next_md["matchday"]),
            "tournament_finished": finished,
            "alive_players": alive,
        }

    # ------------------------------------------------------------------
    # Leaderboard + Riassunto Giornata
    # ------------------------------------------------------------------

    @router.get("/tournaments/{tid}/leaderboard")
    async def leaderboard(tid: str, user: dict = Depends(current_user)):
        t = await _get_tournament(tid)
        _ = t
        cursor = db.sv_participants.find({"tournament_id": tid}, {"_id": 0})
        rows = []
        async for p in cursor:
            rows.append({
                "user_id": p["user_id"],
                "nickname": p["nickname"],
                "lives_left": p.get("lives_left", 0),
                "blocked_signs_count": len(p.get("blocked_signs") or []),
                "eliminated": p.get("eliminated_at") is not None,
                "eliminated_at": p.get("eliminated_at"),
            })
        # Sort: alive first (by lives desc, blocks desc), then eliminated
        rows.sort(key=lambda r: (
            r["eliminated"],
            -r["lives_left"],
            -r["blocked_signs_count"],
            r["nickname"].lower(),
        ))
        for i, r in enumerate(rows):
            r["rank"] = i + 1
        return rows

    @router.get("/tournaments/{tid}/matchdays/{md_id}/summary")
    async def matchday_summary(
        tid: str, md_id: str, user: dict = Depends(current_user),
    ):
        """Riassunto Giornata.

        - Prima del calcio d'inizio della prima partita: mostra SOLO gli
          aggregati (numero di scelte 1/X/2 per ogni partita) e nasconde
          l'identità dei giocatori.
        - Dopo il calcio d'inizio: sblocca anche la lista delle singole
          scelte per ogni utente.
        """
        await _require_participant(tid, user["id"])
        md = await db.sv_matchdays.find_one({"id": md_id, "tournament_id": tid}, {"_id": 0})
        if not md:
            raise HTTPException(status_code=404, detail="Giornata non trovata")

        locked = _md_is_locked(md)
        picks_cur = db.sv_picks.find({"tournament_id": tid, "matchday_id": md_id})

        # Aggregate counts per fixture
        agg: Dict[Tuple[str, str], Dict[str, Any]] = {}
        for f in md.get("fixtures", []):
            agg[(f["home_team"], f["away_team"])] = {
                "home_team": f["home_team"],
                "away_team": f["away_team"],
                "counts": {"1": 0, "X": 0, "2": 0},
                "picks": [] if locked else None,
            }

        async for pk in picks_cur:
            key = (pk["home_team"], pk["away_team"])
            slot = agg.get(key)
            if not slot:
                continue
            p = pk["pick"]
            if p in slot["counts"]:
                slot["counts"][p] += 1
            if locked and slot["picks"] is not None:
                slot["picks"].append({
                    "nickname": pk.get("nickname", "?"),
                    "user_id": pk["user_id"],
                    "pick": p,
                    "correct": pk.get("correct"),
                })

        return {
            "matchday": md["matchday"],
            "kickoff_first": md.get("kickoff_first"),
            "locked": locked,
            "fixtures": list(agg.values()),
        }

    return router


__all__ = ["build_router", "ensure_indexes", "DEFAULT_LIVES"]
