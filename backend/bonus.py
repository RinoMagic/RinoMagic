"""RinoMagic — Bonus Games module.

Each player earns the right to a bonus mini-game every matchday, provided
they are subscribed (via invite) to at least one tournament/room/league of
the corresponding main game. There are two bonus games — the same question
is shared between the two paired main games, but each user's pick is stored
separately per game so a user subscribed to both can play twice.

## Bonus types
- ``exact_score`` — Tiket + Survival: guess the exact final score of the
  admin-selected Big Match of the matchday.
- ``first_scorer`` — Score + Fanta: guess the first goalscorer of the
  matchday.

## Rewards granted on settle
- Tiket: pending ``bonus_credit`` (admin handles the extra bet slip manually)
- Survival: ``+1`` life on every active (non-eliminated) participation
- Score: ``+1`` life on every active (non-eliminated) participation
- Fanta: ``+3`` on the winner's ``fg_matchday_results.total_fantavoto`` for
  every league they were part of that matchday

Rewards are cumulative — no upper cap on lives.

## Collections
- ``bonus_configs``   — one doc per (season, matchday, bonus_type)
- ``bonus_picks``     — one doc per (user_id, game, season, matchday)
- ``bonus_credits``   — Tiket-only pending rewards (admin dashboard)

Endpoints exposed under ``/api/bonus``.
"""
import re
import uuid
import unicodedata
import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any, Callable, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger(__name__)

# Games supported and their bonus type mapping
GAMES = ("tiket", "score", "fanta", "survival")
BONUS_TYPE_BY_GAME: Dict[str, str] = {
    "tiket": "exact_score",
    "survival": "exact_score",
    "score": "first_scorer",
    "fanta": "first_scorer",
}
GAMES_BY_TYPE: Dict[str, Tuple[str, ...]] = {
    "exact_score": ("tiket", "survival"),
    "first_scorer": ("score", "fanta"),
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_scorer(name: str) -> str:
    """Lowercase, strip accents/punctuation, collapse whitespace.

    Used to compare user picks with the admin-provided first-scorer name in
    a case- and accent-insensitive way.
    """
    if not name:
        return ""
    n = unicodedata.normalize("NFD", name)
    n = "".join(c for c in n if unicodedata.category(c) != "Mn")
    n = n.lower()
    n = re.sub(r"[^a-z0-9\s]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


# =========================================================================
# Pydantic bodies
# =========================================================================

class BigMatch(BaseModel):
    home_team: str = Field(min_length=1, max_length=60)
    away_team: str = Field(min_length=1, max_length=60)
    kickoff_iso: Optional[str] = None


class ConfigCreate(BaseModel):
    """Create or update a bonus config for a given (season, matchday, type)."""
    season: str = Field(min_length=3, max_length=10)
    matchday: int = Field(ge=1, le=38)
    bonus_type: str = Field(pattern=r"^(exact_score|first_scorer)$")
    big_match: Optional[BigMatch] = None  # required for exact_score

    @field_validator("bonus_type")
    @classmethod
    def _vt(cls, v):
        return v.strip()


class SettleExact(BaseModel):
    """Admin settles an ``exact_score`` bonus with the final score."""
    home_score: int = Field(ge=0, le=30)
    away_score: int = Field(ge=0, le=30)


class SettleScorer(BaseModel):
    """Admin settles a ``first_scorer`` bonus with the player name."""
    player_name: str = Field(min_length=1, max_length=80)


class PickExactSubmit(BaseModel):
    game: str = Field(pattern=r"^(tiket|survival)$")
    season: str = Field(default="2026-27", min_length=3, max_length=10)
    home_score: int = Field(ge=0, le=30)
    away_score: int = Field(ge=0, le=30)


class PickScorerSubmit(BaseModel):
    game: str = Field(pattern=r"^(score|fanta)$")
    season: str = Field(default="2026-27", min_length=3, max_length=10)
    player_name: str = Field(min_length=1, max_length=80)


# =========================================================================
# Router builder
# =========================================================================

def build_router(*, db, current_user, require_admin, display_name) -> APIRouter:
    router = APIRouter(prefix="/bonus", tags=["bonus"])

    # ------------------------------------------------------------------
    # Eligibility check
    # ------------------------------------------------------------------

    async def _user_eligible(uid: str, game: str) -> bool:
        """A user is eligible for a game's bonus if they have joined at
        least one room/league/tournament of that game (via invite)."""
        if game == "tiket":
            return await db.memberships.find_one({"user_id": uid}) is not None
        if game == "score":
            return await db.sal_participants.find_one({"user_id": uid}) is not None
        if game == "fanta":
            return await db.fg_memberships.find_one({"user_id": uid}) is not None
        if game == "survival":
            return await db.sv_participants.find_one({"user_id": uid}) is not None
        return False

    async def _earliest_kickoff(season: str, matchday: int) -> Optional[str]:
        first = None
        async for fx in db.sal_calendar.find(
            {"season": season, "matchday": matchday}, {"kickoff_iso": 1, "_id": 0},
        ):
            k = fx.get("kickoff_iso")
            if k and (first is None or k < first):
                first = k
        return first

    async def _matchday_fixtures(season: str, matchday: int) -> List[dict]:
        out = []
        async for fx in db.sal_calendar.find(
            {"season": season, "matchday": matchday}, {"_id": 0},
        ):
            out.append({
                "home_team": fx.get("home_team"),
                "away_team": fx.get("away_team"),
                "kickoff_iso": fx.get("kickoff_iso"),
            })
        return out

    def _config_status(cfg: dict) -> str:
        if cfg.get("settled_at"):
            return "settled"
        lock = cfg.get("lock_at")
        if lock:
            # Mongo strips tzinfo → normalise back to UTC for comparison
            if isinstance(lock, datetime) and lock.tzinfo is None:
                lock = lock.replace(tzinfo=timezone.utc)
            if _now() >= lock:
                return "locked"
        return "open"

    async def _config_dict(cfg: dict) -> dict:
        return {
            "id": cfg["id"],
            "season": cfg["season"],
            "matchday": cfg["matchday"],
            "bonus_type": cfg["bonus_type"],
            "games": list(GAMES_BY_TYPE[cfg["bonus_type"]]),
            "big_match": cfg.get("big_match"),
            "lock_at": (cfg.get("lock_at").isoformat() if cfg.get("lock_at") else None),
            "result": cfg.get("result"),
            "status": _config_status(cfg),
            "created_at": (cfg.get("created_at").isoformat() if cfg.get("created_at") else None),
            "settled_at": (cfg.get("settled_at").isoformat() if cfg.get("settled_at") else None),
        }

    async def _pick_dict(p: dict) -> dict:
        return {
            "id": p["id"],
            "user_id": p["user_id"],
            "game": p["game"],
            "season": p["season"],
            "matchday": p["matchday"],
            "bonus_type": p["bonus_type"],
            "pick": p.get("pick"),
            "submitted_at": (p.get("submitted_at").isoformat() if p.get("submitted_at") else None),
            "is_correct": p.get("is_correct"),
            "reward_granted_at": (
                p.get("reward_granted_at").isoformat() if p.get("reward_granted_at") else None
            ),
            "reward_details": p.get("reward_details"),
        }

    # ------------------------------------------------------------------
    # Admin: manage bonus configs
    # ------------------------------------------------------------------

    @router.post("/configs")
    async def create_or_update_config(body: ConfigCreate, user: dict = Depends(require_admin)):
        if body.bonus_type == "exact_score":
            if not body.big_match:
                raise HTTPException(status_code=400, detail="Big Match richiesto per bonus 'exact_score'")
            # Verify the big match is in the season calendar for that matchday
            fx = await db.sal_calendar.find_one({
                "season": body.season, "matchday": body.matchday,
                "home_team": body.big_match.home_team, "away_team": body.big_match.away_team,
            }, {"_id": 0})
            if not fx:
                raise HTTPException(
                    status_code=400,
                    detail="Big Match non presente nel calendario di questa giornata",
                )
            kickoff = fx.get("kickoff_iso") or body.big_match.kickoff_iso
            big_match = {
                "home_team": body.big_match.home_team,
                "away_team": body.big_match.away_team,
                "kickoff_iso": kickoff,
            }
            lock_iso = kickoff
        else:  # first_scorer
            big_match = None
            lock_iso = await _earliest_kickoff(body.season, body.matchday)
            if not lock_iso:
                raise HTTPException(
                    status_code=400,
                    detail="Nessuna partita nel calendario per questa giornata",
                )
        lock_at = None
        if lock_iso:
            try:
                lock_at = datetime.fromisoformat(lock_iso.replace("Z", "+00:00"))
                if lock_at.tzinfo is None:
                    lock_at = lock_at.replace(tzinfo=timezone.utc)
            except Exception:
                lock_at = None
        existing = await db.bonus_configs.find_one({
            "season": body.season, "matchday": body.matchday, "bonus_type": body.bonus_type,
        }, {"_id": 0})
        if existing and existing.get("settled_at"):
            raise HTTPException(
                status_code=400,
                detail="Bonus già liquidato, non modificabile",
            )
        if existing:
            await db.bonus_configs.update_one(
                {"id": existing["id"]},
                {"$set": {"big_match": big_match, "lock_at": lock_at}},
            )
            cfg = await db.bonus_configs.find_one({"id": existing["id"]}, {"_id": 0})
        else:
            cfg = {
                "id": str(uuid.uuid4()),
                "season": body.season,
                "matchday": body.matchday,
                "bonus_type": body.bonus_type,
                "big_match": big_match,
                "lock_at": lock_at,
                "result": None,
                "created_at": _now(),
                "created_by": user["id"],
                "settled_at": None,
            }
            await db.bonus_configs.insert_one(cfg)
        return await _config_dict(cfg)

    @router.get("/configs")
    async def list_configs(user: dict = Depends(current_user)):
        rows = [c async for c in db.bonus_configs.find({}, {"_id": 0})
                                                  .sort([("season", -1), ("matchday", -1)])]
        return [await _config_dict(c) for c in rows]

    @router.get("/configs/{cid}")
    async def get_config(cid: str, user: dict = Depends(current_user)):
        cfg = await db.bonus_configs.find_one({"id": cid}, {"_id": 0})
        if not cfg:
            raise HTTPException(status_code=404, detail="Config non trovata")
        return await _config_dict(cfg)

    @router.delete("/configs/{cid}")
    async def delete_config(cid: str, user: dict = Depends(require_admin)):
        cfg = await db.bonus_configs.find_one({"id": cid}, {"_id": 0})
        if not cfg:
            raise HTTPException(status_code=404, detail="Config non trovata")
        if cfg.get("settled_at"):
            raise HTTPException(status_code=400, detail="Bonus già liquidato: non eliminabile")
        await db.bonus_configs.delete_one({"id": cid})
        await db.bonus_picks.delete_many({
            "season": cfg["season"], "matchday": cfg["matchday"],
            "bonus_type": cfg["bonus_type"],
        })
        return {"ok": True}

    # ------------------------------------------------------------------
    # Reward granting
    # ------------------------------------------------------------------

    async def _grant_reward(pick: dict) -> Dict[str, Any]:
        """Apply the game-specific reward for a winning pick and return
        a JSON-serialisable ``reward_details`` blob describing what was
        granted (for audit and UI display).
        """
        game = pick["game"]
        uid = pick["user_id"]
        matchday = pick["matchday"]
        details: Dict[str, Any] = {"game": game}
        if game == "tiket":
            # Manual handling by admin — just create a pending credit doc.
            credit_id = str(uuid.uuid4())
            await db.bonus_credits.insert_one({
                "id": credit_id, "user_id": uid, "game": "tiket",
                "matchday": matchday, "season": pick["season"],
                "kind": "extra_bet_slip", "pending": True,
                "pick_id": pick["id"], "created_at": _now(),
                "consumed_at": None, "consumed_by": None,
            })
            details["kind"] = "extra_bet_slip_pending"
            details["credit_id"] = credit_id
            return details
        if game in ("score", "survival"):
            coll = "sal_participants" if game == "score" else "sv_participants"
            # Grant +1 life on every non-eliminated participation.
            res = await db[coll].update_many(
                {"user_id": uid, "eliminated_at": None},
                {"$inc": {"lives_left": 1}},
            )
            details["kind"] = "extra_life"
            details["participations_updated"] = int(res.modified_count)
            return details
        if game == "fanta":
            # +3 on every league the user is in for this matchday.
            leagues = [
                m["league_id"] async for m in db.fg_memberships.find(
                    {"user_id": uid}, {"league_id": 1, "_id": 0},
                )
            ]
            updated = 0
            for lid in leagues:
                r = await db.fg_matchday_results.update_one(
                    {"league_id": lid, "user_id": uid, "matchday": matchday},
                    {
                        "$inc": {"total_fantavoto": 3, "bonus_extra": 3},
                        "$setOnInsert": {
                            "id": str(uuid.uuid4()),
                            "league_id": lid, "user_id": uid,
                            "matchday": matchday,
                            "computed_at": _now(),
                        },
                    },
                    upsert=True,
                )
                if r.modified_count or r.upserted_id:
                    updated += 1
            details["kind"] = "fanta_bonus_points"
            details["points"] = 3
            details["leagues_updated"] = updated
            return details
        details["kind"] = "unknown"
        return details

    # ------------------------------------------------------------------
    # Admin: settle a bonus (compute winners + grant rewards)
    # ------------------------------------------------------------------

    async def _settle(cfg: dict, admin_user: dict) -> dict:
        picks = [
            p async for p in db.bonus_picks.find({
                "season": cfg["season"], "matchday": cfg["matchday"],
                "bonus_type": cfg["bonus_type"],
            }, {"_id": 0})
        ]
        winners = 0
        already_granted = 0
        for p in picks:
            if cfg["bonus_type"] == "exact_score":
                r = cfg.get("result") or {}
                pk = p.get("pick") or {}
                is_ok = (
                    pk.get("home_score") == r.get("home_score")
                    and pk.get("away_score") == r.get("away_score")
                )
            else:  # first_scorer
                r = cfg.get("result") or {}
                pk = p.get("pick") or {}
                is_ok = (
                    _normalize_scorer(pk.get("player_name") or "")
                    == _normalize_scorer(r.get("player_name") or "")
                    and bool(r.get("player_name"))
                )
            already = bool(p.get("reward_granted_at"))
            patch: Dict[str, Any] = {"is_correct": bool(is_ok)}
            if is_ok and not already:
                details = await _grant_reward(p)
                patch["reward_granted_at"] = _now()
                patch["reward_details"] = details
                winners += 1
            elif is_ok and already:
                already_granted += 1
            await db.bonus_picks.update_one({"id": p["id"]}, {"$set": patch})
        await db.bonus_configs.update_one(
            {"id": cfg["id"]},
            {"$set": {"settled_at": _now(), "settled_by": admin_user["id"]}},
        )
        cfg = await db.bonus_configs.find_one({"id": cfg["id"]}, {"_id": 0})
        return {
            "config": await _config_dict(cfg),
            "total_picks": len(picks),
            "winners": winners,
            "already_granted": already_granted,
        }

    @router.post("/configs/{cid}/settle-exact")
    async def settle_exact(cid: str, body: SettleExact, user: dict = Depends(require_admin)):
        cfg = await db.bonus_configs.find_one({"id": cid}, {"_id": 0})
        if not cfg:
            raise HTTPException(status_code=404, detail="Config non trovata")
        if cfg["bonus_type"] != "exact_score":
            raise HTTPException(status_code=400, detail="Bonus non 'exact_score'")
        await db.bonus_configs.update_one(
            {"id": cid},
            {"$set": {"result": {"home_score": body.home_score, "away_score": body.away_score}}},
        )
        cfg = await db.bonus_configs.find_one({"id": cid}, {"_id": 0})
        return await _settle(cfg, user)

    @router.post("/configs/{cid}/settle-scorer")
    async def settle_scorer(cid: str, body: SettleScorer, user: dict = Depends(require_admin)):
        cfg = await db.bonus_configs.find_one({"id": cid}, {"_id": 0})
        if not cfg:
            raise HTTPException(status_code=404, detail="Config non trovata")
        if cfg["bonus_type"] != "first_scorer":
            raise HTTPException(status_code=400, detail="Bonus non 'first_scorer'")
        await db.bonus_configs.update_one(
            {"id": cid},
            {"$set": {"result": {"player_name": body.player_name.strip()}}},
        )
        cfg = await db.bonus_configs.find_one({"id": cid}, {"_id": 0})
        return await _settle(cfg, user)

    # ------------------------------------------------------------------
    # Player: eligibility, available bonus, picks
    # ------------------------------------------------------------------

    @router.get("/eligibility")
    async def eligibility(user: dict = Depends(current_user)):
        out = {}
        for g in GAMES:
            out[g] = await _user_eligible(user["id"], g)
        return out

    @router.get("/available")
    async def available(
        game: str,
        season: str = "2026-27",
        user: dict = Depends(current_user),
    ):
        """Current open/locked bonus for a game (the most recent one for the
        matchday cycle that has not been settled yet). Includes the user's
        pick if any, and eligibility flag.
        """
        if game not in GAMES:
            raise HTTPException(status_code=400, detail="Gioco non valido")
        eligible = await _user_eligible(user["id"], game)
        bonus_type = BONUS_TYPE_BY_GAME[game]
        cfg = await db.bonus_configs.find_one(
            {"season": season, "bonus_type": bonus_type, "settled_at": None},
            {"_id": 0}, sort=[("matchday", -1)],
        )
        if not cfg:
            return {
                "game": game, "bonus_type": bonus_type, "season": season,
                "eligible": eligible, "config": None, "my_pick": None,
                "fixtures": [],
            }
        my_pick = None
        if eligible:
            p = await db.bonus_picks.find_one({
                "user_id": user["id"], "game": game,
                "season": season, "matchday": cfg["matchday"],
            }, {"_id": 0})
            if p:
                my_pick = await _pick_dict(p)
        # Bonus type 1 (exact_score): we return the big match. Bonus type 2:
        # we return no fixtures — just the earliest kickoff for the countdown.
        fixtures = []
        if bonus_type == "exact_score":
            # Also return the matchday fixtures so admins can pick among them.
            fixtures = await _matchday_fixtures(season, cfg["matchday"])
        return {
            "game": game, "bonus_type": bonus_type, "season": season,
            "eligible": eligible,
            "config": await _config_dict(cfg),
            "my_pick": my_pick,
            "fixtures": fixtures,
        }

    async def _check_config_open(cfg: dict) -> None:
        status = _config_status(cfg)
        if status == "settled":
            raise HTTPException(status_code=400, detail="Bonus già liquidato")
        if status == "locked":
            raise HTTPException(status_code=400, detail="Countdown scaduto: pronostici bloccati")

    @router.post("/picks/exact")
    async def submit_exact(body: PickExactSubmit, user: dict = Depends(current_user)):
        if BONUS_TYPE_BY_GAME[body.game] != "exact_score":
            raise HTTPException(status_code=400, detail="Gioco non valido per bonus 'exact_score'")
        if not await _user_eligible(user["id"], body.game):
            raise HTTPException(
                status_code=403,
                detail=f"Non sei iscritto a nessun torneo/stanza di {body.game.title()}",
            )
        cfg = await db.bonus_configs.find_one(
            {"season": body.season, "bonus_type": "exact_score", "settled_at": None},
            {"_id": 0}, sort=[("matchday", -1)],
        )
        if not cfg:
            raise HTTPException(status_code=404, detail="Nessun bonus attivo")
        await _check_config_open(cfg)
        pick_data = {"home_score": body.home_score, "away_score": body.away_score}
        return await _upsert_pick(cfg, body.game, user, pick_data)

    @router.post("/picks/scorer")
    async def submit_scorer(body: PickScorerSubmit, user: dict = Depends(current_user)):
        if BONUS_TYPE_BY_GAME[body.game] != "first_scorer":
            raise HTTPException(status_code=400, detail="Gioco non valido per bonus 'first_scorer'")
        if not await _user_eligible(user["id"], body.game):
            raise HTTPException(
                status_code=403,
                detail=f"Non sei iscritto a nessun torneo/stanza di {body.game.title()}",
            )
        cfg = await db.bonus_configs.find_one(
            {"season": body.season, "bonus_type": "first_scorer", "settled_at": None},
            {"_id": 0}, sort=[("matchday", -1)],
        )
        if not cfg:
            raise HTTPException(status_code=404, detail="Nessun bonus attivo")
        await _check_config_open(cfg)
        name = body.player_name.strip()
        pick_data = {"player_name": name, "player_name_norm": _normalize_scorer(name)}
        return await _upsert_pick(cfg, body.game, user, pick_data)

    async def _upsert_pick(cfg: dict, game: str, user: dict, pick_data: dict) -> dict:
        existing = await db.bonus_picks.find_one({
            "user_id": user["id"], "game": game,
            "season": cfg["season"], "matchday": cfg["matchday"],
        }, {"_id": 0})
        if existing:
            await db.bonus_picks.update_one(
                {"id": existing["id"]},
                {"$set": {"pick": pick_data, "submitted_at": _now()}},
            )
            existing = await db.bonus_picks.find_one({"id": existing["id"]}, {"_id": 0})
            return await _pick_dict(existing)
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "nickname": display_name(user),
            "game": game,
            "season": cfg["season"],
            "matchday": cfg["matchday"],
            "bonus_type": cfg["bonus_type"],
            "pick": pick_data,
            "submitted_at": _now(),
            "is_correct": None,
            "reward_granted_at": None,
            "reward_details": None,
        }
        await db.bonus_picks.insert_one(doc)
        return await _pick_dict(doc)

    @router.get("/history")
    async def history(
        game: str,
        season: str = "2026-27",
        limit: int = 20,
        user: dict = Depends(current_user),
    ):
        if game not in GAMES:
            raise HTTPException(status_code=400, detail="Gioco non valido")
        rows = [
            p async for p in db.bonus_picks.find({
                "user_id": user["id"], "game": game, "season": season,
            }, {"_id": 0}).sort("matchday", -1).limit(limit)
        ]
        return [await _pick_dict(p) for p in rows]

    # Public matchday leaderboard (aggregate — no per-user picks leaked
    # before kickoff, mirroring the Riassunto Giornata privacy pattern).
    @router.get("/configs/{cid}/summary")
    async def summary(cid: str, user: dict = Depends(current_user)):
        cfg = await db.bonus_configs.find_one({"id": cid}, {"_id": 0})
        if not cfg:
            raise HTTPException(status_code=404, detail="Config non trovata")
        status = _config_status(cfg)
        reveal = status in ("locked", "settled")
        picks = [
            p async for p in db.bonus_picks.find({
                "season": cfg["season"], "matchday": cfg["matchday"],
                "bonus_type": cfg["bonus_type"],
            }, {"_id": 0})
        ]
        by_game: Dict[str, int] = {g: 0 for g in GAMES_BY_TYPE[cfg["bonus_type"]]}
        winners_by_game: Dict[str, int] = {g: 0 for g in GAMES_BY_TYPE[cfg["bonus_type"]]}
        for p in picks:
            g = p.get("game")
            if g in by_game:
                by_game[g] += 1
            if p.get("is_correct") and g in winners_by_game:
                winners_by_game[g] += 1
        details = None
        if reveal:
            details = [
                {
                    "nickname": p.get("nickname"),
                    "game": p.get("game"),
                    "pick": p.get("pick"),
                    "is_correct": p.get("is_correct"),
                }
                for p in picks
            ]
        return {
            "config": await _config_dict(cfg),
            "total_picks": len(picks),
            "picks_by_game": by_game,
            "winners_by_game": winners_by_game,
            "details": details,
        }

    return router


async def ensure_indexes(db) -> None:
    await db.bonus_configs.create_index("id", unique=True)
    await db.bonus_configs.create_index(
        [("season", 1), ("matchday", 1), ("bonus_type", 1)],
        unique=True,
    )
    await db.bonus_picks.create_index("id", unique=True)
    await db.bonus_picks.create_index(
        [("user_id", 1), ("game", 1), ("season", 1), ("matchday", 1)],
        unique=True,
    )
    await db.bonus_picks.create_index(
        [("season", 1), ("matchday", 1), ("bonus_type", 1)]
    )
    await db.bonus_credits.create_index("id", unique=True)
    await db.bonus_credits.create_index([("user_id", 1), ("game", 1), ("pending", 1)])


__all__ = ["build_router", "ensure_indexes"]
