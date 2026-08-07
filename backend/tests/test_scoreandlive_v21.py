"""Regression tests for ScoreAndLive v2.1 rules.

New rules being validated:
- Initial lives = 10 by default for new tournaments
- Required picks per matchday = min(lives_remaining, num_playable_fixtures)
- Player freely chooses WHICH N matches to play (others skipped, no life lost)
- Settle: -1 life per wrong scorer, +1 life per correct scorer
- Max lives cap = 15
- Bonus 'first_scorer' for Score now gives +3 lives (capped at 15)
- If lives_remaining reaches 0 → user eliminated

All tests run against the public preview URL. Motor is used for a couple of
targeted DB overrides (initial-lives edge cases) as suggested in the review
request. Every test cleans up any tournament / bonus config it creates.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from typing import Dict, List, Optional, Tuple

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://fantasy-calcio-15.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "verone.salvatore@libero.it"
ADMIN_PASSWORD = "SchedinaBar2026!"

SEASON = "2026-27"
START_MD = 5

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "schedinabar")

_created_tournaments: List[str] = []
_created_bonus_configs: List[str] = []


# --------------------------------------------------------------------------
# Fixtures & helpers
# --------------------------------------------------------------------------
def _h(tok: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_tok() -> str:
    r = requests.post(
        f"{API}/auth/admin/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_id(admin_tok) -> str:
    r = requests.get(f"{API}/auth/me", headers=_h(admin_tok), timeout=15)
    assert r.status_code == 200
    return r.json()["id"]


@pytest.fixture(scope="module")
def calendar_g5(admin_tok) -> List[dict]:
    r = requests.get(
        f"{API}/sal/calendar?season={SEASON}&matchday=5",
        headers=_h(admin_tok), timeout=15,
    )
    assert r.status_code == 200
    fixtures = r.json()["fixtures"]
    assert len(fixtures) == 10, f"G5 must have 10 fixtures, has {len(fixtures)}"
    return fixtures


@pytest.fixture(scope="module")
def calendar_g6(admin_tok) -> List[dict]:
    r = requests.get(
        f"{API}/sal/calendar?season={SEASON}&matchday=6",
        headers=_h(admin_tok), timeout=15,
    )
    assert r.status_code == 200
    return r.json()["fixtures"]


@pytest.fixture(scope="module")
def all_players(admin_tok) -> List[dict]:
    # Endpoint caps limit at 1000 (Query ge=1, le=1000).
    r = requests.get(
        f"{API}/sal/players?limit=1000",
        headers=_h(admin_tok), timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _players_by_team(players: List[dict]) -> Dict[str, List[dict]]:
    idx: Dict[str, List[dict]] = {}
    for p in players:
        team = (p.get("team") or "").strip().lower()
        idx.setdefault(team, []).append(p)
    return idx


def _pick_one_player_per_fixture(
    fixtures: List[dict], players_by_team: Dict[str, List[dict]],
    exclude_ids: Optional[set] = None,
) -> List[dict]:
    """For each of the 10 fixtures, pick ONE player of the home team.

    Returns the list of pick payloads: [{fixture_idx, player_id}, ...].
    exclude_ids: player ids to skip (already used in a previous MD → blocked).
    """
    exclude_ids = exclude_ids or set()
    out = []
    for i, fx in enumerate(fixtures):
        home_key = fx["home_team"].strip().lower()
        away_key = fx["away_team"].strip().lower()
        candidates = (
            [p for p in players_by_team.get(home_key, []) if p["id"] not in exclude_ids]
            or [p for p in players_by_team.get(away_key, []) if p["id"] not in exclude_ids]
        )
        assert candidates, (
            f"No available player for fixture {i}: {fx['home_team']} vs {fx['away_team']}"
        )
        out.append({"fixture_idx": i, "player_id": candidates[0]["id"]})
    return out


def _create_tournament(admin_tok: str, *, name: str, initial_lives: int,
                       start_matchday: int) -> dict:
    r = requests.post(
        f"{API}/sal/tournaments",
        headers=_h(admin_tok),
        json={"name": name, "initial_lives": initial_lives,
              "start_matchday": start_matchday, "season": SEASON},
        timeout=15,
    )
    assert r.status_code == 200, f"create tournament: {r.status_code} {r.text}"
    t = r.json()
    _created_tournaments.append(t["id"])
    return t


def _get_matchday_by_number(admin_tok: str, tid: str, md_num: int) -> dict:
    r = requests.get(f"{API}/sal/tournaments/{tid}", headers=_h(admin_tok), timeout=15)
    assert r.status_code == 200, r.text
    for md in r.json().get("matchdays", []) or []:
        if md.get("matchday_number") == md_num:
            return md
    raise AssertionError(f"MD {md_num} not found on tournament {tid}")


def _get_matchday_detail(admin_tok: str, tid: str, md_id: str) -> dict:
    r = requests.get(
        f"{API}/sal/tournaments/{tid}/matchdays/{md_id}",
        headers=_h(admin_tok), timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _get_participant_lives(admin_tok: str, tid: str, user_id: str) -> Tuple[int, Optional[int]]:
    """Returns (lives_remaining, eliminated_at_matchday)."""
    r = requests.get(f"{API}/sal/tournaments/{tid}", headers=_h(admin_tok), timeout=15)
    assert r.status_code == 200, r.text
    for p in r.json().get("participants", []) or []:
        if p.get("user_id") == user_id:
            return int(p.get("lives_remaining", 0)), p.get("eliminated_at_matchday")
    raise AssertionError(f"participant {user_id} not on tournament {tid}")


async def _db_set_lives(tid: str, user_id: str, lives: int) -> None:
    client = AsyncIOMotorClient(MONGO_URL)
    try:
        db = client[DB_NAME]
        r = await db.sal_participants.update_one(
            {"tournament_id": tid, "user_id": user_id},
            {"$set": {"lives_remaining": lives, "eliminated_at_matchday": None}},
        )
        assert r.matched_count == 1, f"no participant found for {tid}/{user_id}"
    finally:
        client.close()


def _set_lives_sync(tid: str, user_id: str, lives: int) -> None:
    asyncio.get_event_loop().run_until_complete(_db_set_lives(tid, user_id, lives))


# --------------------------------------------------------------------------
# TEST 1 — submit_picks validation on initial matchday
# --------------------------------------------------------------------------
class TestSubmitPicksValidation:
    """Torneo initial_lives=10, start_matchday=5 → expected_picks=10."""

    def test_create_tournament_and_defaults(self, admin_tok, admin_id, calendar_g5):
        t = _create_tournament(
            admin_tok, name=f"TEST_v21_T1_{uuid.uuid4().hex[:6]}",
            initial_lives=10, start_matchday=5,
        )
        pytest.tid_t1 = t["id"]

        # Admin is auto-enrolled with 10 lives
        lives, elim = _get_participant_lives(admin_tok, t["id"], admin_id)
        assert lives == 10 and elim is None

        md = _get_matchday_by_number(admin_tok, t["id"], 5)
        pytest.md_t1_g5 = md["id"]
        detail = _get_matchday_detail(admin_tok, t["id"], md["id"])
        assert detail["playable_fixtures_count"] == 10
        assert detail["expected_picks_count"] == 10
        assert detail["my_lives_remaining"] == 10
        assert detail["max_lives"] == 15

    def test_submit_9_picks_returns_400(self, admin_tok, calendar_g5, all_players):
        tid = pytest.tid_t1
        md_id = pytest.md_t1_g5
        by_team = _players_by_team(all_players)
        picks_10 = _pick_one_player_per_fixture(calendar_g5, by_team)
        picks_9 = picks_10[:9]
        r = requests.post(
            f"{API}/sal/tournaments/{tid}/matchdays/{md_id}/picks",
            headers=_h(admin_tok),
            json={"picks": picks_9}, timeout=15,
        )
        assert r.status_code == 400, r.text
        detail = r.json().get("detail", "")
        assert "esattamente 10" in detail and "10 vite" in detail and "9" in detail, detail

    def test_submit_10_picks_returns_200(self, admin_tok, calendar_g5, all_players):
        tid = pytest.tid_t1
        md_id = pytest.md_t1_g5
        by_team = _players_by_team(all_players)
        picks_10 = _pick_one_player_per_fixture(calendar_g5, by_team)
        pytest.picks_t1_g5 = picks_10
        r = requests.post(
            f"{API}/sal/tournaments/{tid}/matchdays/{md_id}/picks",
            headers=_h(admin_tok),
            json={"picks": picks_10}, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert len(body["picks"]) == 10


# --------------------------------------------------------------------------
# TEST 2 — settle with 4 hits, 6 misses → 10-6+4 = 8 lives
# --------------------------------------------------------------------------
class TestSettleAndDynamicPicks:

    def test_settle_g5_with_4_hits(self, admin_tok, calendar_g5, all_players, admin_id):
        tid = pytest.tid_t1
        md_id = pytest.md_t1_g5
        picks = pytest.picks_t1_g5  # 10 picks with player_id per fixture

        # Correct scorers = the exact player_id the admin picked in first 4 fixtures.
        # Misses = fixtures 4..9 → we submit a DIFFERENT scorer_id (or none).
        # Simplest: only submit 4 correct scorers, no scorer for the other 6
        # → those become misses (since the player_id we picked isn't scorer).
        scorers_payload = [
            {"fixture_idx": p["fixture_idx"], "player_id": p["player_id"]}
            for p in picks[:4]
        ]
        # For the remaining 6, pick a DIFFERENT player of the home team (to
        # make it explicit these are "someone else scored" and the admin's
        # pick misses). If we skip these completely with no scorers reported,
        # the code still treats them as misses (the pick's player_id isn't
        # in scorers_by_fixture) — same result. Keep it simple: no scorers.

        r = requests.post(
            f"{API}/sal/tournaments/{tid}/matchdays/{md_id}/settle",
            headers=_h(admin_tok),
            json={"scorers": scorers_payload, "postponed_during": []},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["settled"] is True

        # Expected lives = 10 - 6 misses + 4 hits = 8
        lives, elim = _get_participant_lives(admin_tok, tid, admin_id)
        assert lives == 8, f"expected 8 lives, got {lives}"
        assert elim is None

    def test_g6_dynamic_expected_picks(self, admin_tok, admin_id):
        tid = pytest.tid_t1
        md6 = _get_matchday_by_number(admin_tok, tid, 6)
        pytest.md_t1_g6 = md6["id"]
        detail = _get_matchday_detail(admin_tok, tid, md6["id"])
        assert detail["my_lives_remaining"] == 8
        assert detail["max_lives"] == 15
        assert detail["playable_fixtures_count"] == 10
        assert detail["expected_picks_count"] == 8


# --------------------------------------------------------------------------
# TEST 3 — For G6, must submit exactly 8 picks
# --------------------------------------------------------------------------
class TestSubmitLessThanLives:

    def test_g6_submit_8_ok(self, admin_tok, calendar_g6, all_players):
        tid = pytest.tid_t1
        md_id = pytest.md_t1_g6
        by_team = _players_by_team(all_players)

        # Player 'blocked_players_by_user' now contains the 4 hits from G5 —
        # avoid re-picking them (would 400 with "Hai già usato ...").
        # Grab tournament to read blocked list.
        r = requests.get(f"{API}/sal/tournaments/{tid}", headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200
        blocked = set(r.json().get("blocked_players_by_user", {}).get(pytest.admin_id_val, []))

        picks_all = _pick_one_player_per_fixture(
            calendar_g6, by_team, exclude_ids=blocked,
        )
        pytest.picks_t1_g6_full = picks_all
        picks_8 = picks_all[:8]

        r = requests.post(
            f"{API}/sal/tournaments/{tid}/matchdays/{md_id}/picks",
            headers=_h(admin_tok),
            json={"picks": picks_8}, timeout=15,
        )
        assert r.status_code == 200, r.text

    def test_g6_submit_7_returns_400(self, admin_tok):
        tid = pytest.tid_t1
        md_id = pytest.md_t1_g6
        picks_7 = pytest.picks_t1_g6_full[:7]
        r = requests.post(
            f"{API}/sal/tournaments/{tid}/matchdays/{md_id}/picks",
            headers=_h(admin_tok),
            json={"picks": picks_7}, timeout=15,
        )
        assert r.status_code == 400, r.text
        assert "esattamente 8" in r.json().get("detail", "")

    def test_g6_submit_9_returns_400(self, admin_tok):
        tid = pytest.tid_t1
        md_id = pytest.md_t1_g6
        picks_9 = pytest.picks_t1_g6_full[:9]
        r = requests.post(
            f"{API}/sal/tournaments/{tid}/matchdays/{md_id}/picks",
            headers=_h(admin_tok),
            json={"picks": picks_9}, timeout=15,
        )
        assert r.status_code == 400, r.text
        assert "esattamente 8" in r.json().get("detail", "")


# --------------------------------------------------------------------------
# TEST 4 — cap at 15 lives
# Tournament with initial_lives=13; DB-force lives=13 (fresh anyway),
# settle with 6 hits + 4 misses → min(15, 13+6-4)=15.
# --------------------------------------------------------------------------
class TestCapMaxLives:

    def test_create_second_tournament_and_cap(
        self, admin_tok, admin_id, calendar_g5, all_players,
    ):
        t = _create_tournament(
            admin_tok, name=f"TEST_v21_T4_{uuid.uuid4().hex[:6]}",
            initial_lives=13, start_matchday=5,
        )
        tid = t["id"]

        # Ensure a clean lives_remaining = 13
        _set_lives_sync(tid, admin_id, 13)

        md5 = _get_matchday_by_number(admin_tok, tid, 5)
        detail = _get_matchday_detail(admin_tok, tid, md5["id"])
        # expected_picks = min(13, 10) = 10
        assert detail["expected_picks_count"] == 10
        assert detail["my_lives_remaining"] == 13
        assert detail["max_lives"] == 15

        by_team = _players_by_team(all_players)
        picks_10 = _pick_one_player_per_fixture(calendar_g5, by_team)
        r = requests.post(
            f"{API}/sal/tournaments/{tid}/matchdays/{md5['id']}/picks",
            headers=_h(admin_tok),
            json={"picks": picks_10}, timeout=15,
        )
        assert r.status_code == 200, r.text

        # Settle with 6 hits + 4 misses → new_lives_raw = 13 + 6 - 4 = 15 (cap)
        scorers = [
            {"fixture_idx": p["fixture_idx"], "player_id": p["player_id"]}
            for p in picks_10[:6]
        ]
        r = requests.post(
            f"{API}/sal/tournaments/{tid}/matchdays/{md5['id']}/settle",
            headers=_h(admin_tok),
            json={"scorers": scorers, "postponed_during": []},
            timeout=15,
        )
        assert r.status_code == 200, r.text

        lives, elim = _get_participant_lives(admin_tok, tid, admin_id)
        assert lives == 15, f"expected lives capped at 15, got {lives}"
        assert elim is None


# --------------------------------------------------------------------------
# TEST 5 — elimination when lives → 0
# --------------------------------------------------------------------------
class TestElimination:

    def test_eliminated_when_lives_zero(
        self, admin_tok, admin_id, calendar_g5, all_players,
    ):
        t = _create_tournament(
            admin_tok, name=f"TEST_v21_T5_{uuid.uuid4().hex[:6]}",
            initial_lives=2, start_matchday=5,
        )
        tid = t["id"]

        md5 = _get_matchday_by_number(admin_tok, tid, 5)
        detail = _get_matchday_detail(admin_tok, tid, md5["id"])
        # expected = min(2, 10) = 2
        assert detail["expected_picks_count"] == 2
        assert detail["my_lives_remaining"] == 2

        by_team = _players_by_team(all_players)
        picks_all = _pick_one_player_per_fixture(calendar_g5, by_team)
        picks_2 = picks_all[:2]
        r = requests.post(
            f"{API}/sal/tournaments/{tid}/matchdays/{md5['id']}/picks",
            headers=_h(admin_tok),
            json={"picks": picks_2}, timeout=15,
        )
        assert r.status_code == 200, r.text

        # Settle with 0 hits (report a scorer that is NOT the picked player)
        # Simplest: no scorers at all — both picks become misses → -2 lives.
        r = requests.post(
            f"{API}/sal/tournaments/{tid}/matchdays/{md5['id']}/settle",
            headers=_h(admin_tok),
            json={"scorers": [], "postponed_during": []},
            timeout=15,
        )
        assert r.status_code == 200, r.text

        lives, elim = _get_participant_lives(admin_tok, tid, admin_id)
        assert lives == 0, f"expected 0 lives, got {lives}"
        assert elim == 5, f"expected eliminated_at_matchday=5, got {elim}"

        # Try to submit picks on G6 → 400 "Sei stato eliminato dal torneo"
        md6 = _get_matchday_by_number(admin_tok, tid, 6)
        r = requests.post(
            f"{API}/sal/tournaments/{tid}/matchdays/{md6['id']}/picks",
            headers=_h(admin_tok),
            json={"picks": [{"fixture_idx": 0,
                             "player_id": picks_all[0]["player_id"]}]},
            timeout=15,
        )
        assert r.status_code == 400, r.text
        assert "eliminato" in r.json().get("detail", "").lower()


# --------------------------------------------------------------------------
# TEST 6 — bonus first_scorer gives +3 lives, capped at 15
# --------------------------------------------------------------------------
class TestFirstScorerBonus:

    def _create_bonus_config(self, admin_tok, matchday: int) -> str:
        r = requests.post(
            f"{API}/bonus/configs",
            headers=_h(admin_tok),
            json={"season": SEASON, "matchday": matchday,
                  "bonus_type": "first_scorer"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        if cid not in _created_bonus_configs:
            _created_bonus_configs.append(cid)
        return cid

    def test_bonus_plus3_and_cap(self, admin_tok, admin_id):
        # Fresh tournament initial_lives=5 to keep math clean.
        t = _create_tournament(
            admin_tok, name=f"TEST_v21_T6_{uuid.uuid4().hex[:6]}",
            initial_lives=5, start_matchday=5,
        )
        tid = t["id"]

        # Create/ensure first_scorer bonus config for G5. NOTE: the SAL
        # tournament creation already ensures a draft; re-posting is fine.
        cid = self._create_bonus_config(admin_tok, 5)

        # Get subscriptions for game=score — must contain our new tournament
        r = requests.get(
            f"{API}/bonus/subscriptions?game=score",
            headers=_h(admin_tok), timeout=15,
        )
        assert r.status_code == 200, r.text
        subs = r.json()
        sub_ids = {s["id"] for s in subs}
        assert tid in sub_ids, f"tournament not in bonus subs: {sub_ids}"

        # Submit a scorer pick
        SCORER = "Mario Rossi Bonus Test"
        r = requests.post(
            f"{API}/bonus/picks/scorer",
            headers=_h(admin_tok),
            json={"game": "score", "season": SEASON,
                  "subscription_id": tid, "player_name": SCORER},
            timeout=15,
        )
        assert r.status_code == 200, r.text

        # Settle bonus with same scorer → admin wins → +3 lives
        r = requests.post(
            f"{API}/bonus/configs/{cid}/settle-scorer",
            headers=_h(admin_tok),
            json={"player_name": SCORER}, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["winners"] >= 1, body

        lives, _ = _get_participant_lives(admin_tok, tid, admin_id)
        assert lives == 5 + 3, f"expected 8 lives after +3 bonus, got {lives}"

    def test_bonus_cap_at_15(self, admin_tok, admin_id):
        # New tournament for a G6 bonus test. Start lives=14 (via DB).
        t = _create_tournament(
            admin_tok, name=f"TEST_v21_T6cap_{uuid.uuid4().hex[:6]}",
            initial_lives=14, start_matchday=6,
        )
        tid = t["id"]
        _set_lives_sync(tid, admin_id, 14)

        # Create bonus config for G6
        cid = self._create_bonus_config(admin_tok, 6)

        SCORER = f"BonusCapUser_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/bonus/picks/scorer",
            headers=_h(admin_tok),
            json={"game": "score", "season": SEASON,
                  "subscription_id": tid, "player_name": SCORER},
            timeout=15,
        )
        assert r.status_code == 200, r.text

        r = requests.post(
            f"{API}/bonus/configs/{cid}/settle-scorer",
            headers=_h(admin_tok),
            json={"player_name": SCORER}, timeout=15,
        )
        assert r.status_code == 200, r.text

        lives, _ = _get_participant_lives(admin_tok, tid, admin_id)
        assert lives == 15, (
            f"expected capped at 15 lives (14+3 clamped to 15), got {lives}"
        )


# --------------------------------------------------------------------------
# TEST 7 — cleanup: delete all created tournaments + bonus configs.
# --------------------------------------------------------------------------
class TestCleanup:

    def test_delete_all_created_tournaments(self, admin_tok):
        # Sweep by name-prefix so we also catch Round-2 tournaments that
        # were auto-spawned by _close_tournament_and_advance when TEST 5's
        # tournament ended (0 alive after elimination). The tournament
        # detail endpoint does NOT return next_tournament_id inline, so
        # a name-based sweep is the cleanest way to catch descendants.
        r = requests.get(
            f"{API}/sal/tournaments", headers=_h(admin_tok), timeout=15,
        )
        if r.status_code == 200:
            for t in r.json():
                nm = t.get("name") or ""
                if nm.startswith("TEST_v21") and t["id"] not in _created_tournaments:
                    _created_tournaments.append(t["id"])

        remaining_errors = []
        for tid in list(_created_tournaments):
            # First try without force
            r = requests.delete(
                f"{API}/sal/tournaments/{tid}",
                headers=_h(admin_tok), timeout=15,
            )
            if r.status_code == 409:
                # Has historical picks — needs force=true
                r = requests.delete(
                    f"{API}/sal/tournaments/{tid}?force=true",
                    headers=_h(admin_tok), timeout=15,
                )
            if r.status_code not in (200, 404):
                remaining_errors.append((tid, r.status_code, r.text))
        assert not remaining_errors, f"cleanup failures: {remaining_errors}"

    def test_delete_all_created_bonus_configs(self, admin_tok):
        errs = []
        for cid in list(_created_bonus_configs):
            r = requests.delete(
                f"{API}/bonus/configs/{cid}",
                headers=_h(admin_tok), timeout=15,
            )
            if r.status_code not in (200, 404):
                errs.append((cid, r.status_code, r.text))
        assert not errs, f"bonus cleanup failures: {errs}"


# Shared cross-class user id (populated in Test1 via admin_id fixture usage).
@pytest.fixture(autouse=True)
def _stash_admin_id(admin_id):
    pytest.admin_id_val = admin_id
