"""
FantaGiornata iteration 5 tests:
- GET /api/system (any authenticated user)
- POST /api/system/matchday (system admin only)
- POST /api/system/scheduler (system admin only)
- POST /api/system/sync-now (system admin only, api-football suspended -> 400)
- api_votes global cache fallback in _compute_user_total (via /leagues/{id}/results/{md})
"""
import os
import asyncio
import uuid
import pytest
import requests
from conftest import API, auth_headers, ADMIN_EMAIL

# Load backend .env so MONGO_URL is available to this test process
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


def _mongo_upsert_api_vote(matchday: int, player_id: str, doc: dict) -> None:
    async def _run():
        client = AsyncIOMotorClient(MONGO_URL)
        try:
            await client[DB_NAME].api_votes.update_one(
                {"matchday": matchday, "player_id": player_id},
                {"$set": doc}, upsert=True,
            )
        finally:
            client.close()
    asyncio.run(_run())


def _mongo_delete_api_vote(matchday: int, player_id: str) -> None:
    async def _run():
        client = AsyncIOMotorClient(MONGO_URL)
        try:
            await client[DB_NAME].api_votes.delete_one(
                {"matchday": matchday, "player_id": player_id}
            )
        finally:
            client.close()
    asyncio.run(_run())


# ---------------- GET /api/system ----------------
class TestGetSystem:
    def test_requires_auth(self, session):
        r = session.get(f"{API}/system", headers={"Authorization": ""})
        assert r.status_code == 401

    def test_returns_expected_fields(self, session, user1):
        r = session.get(f"{API}/system", headers=auth_headers(user1["token"]))
        assert r.status_code == 200, r.text
        data = r.json()
        expected = {
            "current_matchday", "current_season", "scheduler_enabled",
            "scheduler_running", "in_match_window", "server_time_rome",
            "last_scheduled_sync_at", "last_scheduled_sync_count",
            "last_scheduled_sync_error", "api_votes_by_matchday",
            "match_windows",
        }
        missing = expected - set(data.keys())
        assert not missing, f"missing keys: {missing}, got: {list(data.keys())}"
        assert isinstance(data["current_matchday"], int)
        assert isinstance(data["current_season"], int)
        assert isinstance(data["scheduler_enabled"], bool)
        assert isinstance(data["scheduler_running"], bool)
        assert isinstance(data["in_match_window"], bool)
        assert isinstance(data["server_time_rome"], str)
        assert isinstance(data["api_votes_by_matchday"], dict)
        assert isinstance(data["match_windows"], dict)
        # Rome match windows contains at least Mon/Fri/Sat/Sun weekdays as string keys 0..6
        assert any(k in data["match_windows"] for k in ["0", "4", "5", "6"])


# ---------------- POST /api/system/matchday ----------------
class TestSetMatchday:
    def test_non_admin_gets_403(self, session, user1):
        r = session.post(f"{API}/system/matchday", json={"matchday": 5},
                         headers=auth_headers(user1["token"]))
        assert r.status_code == 403, r.text
        # Italian message about system admin
        assert "admin di sistema" in r.json().get("detail", "").lower()

    def test_admin_can_set_and_get_reflects(self, session, admin_token, user1):
        # Read current so we can restore
        pre = session.get(f"{API}/system", headers=auth_headers(user1["token"])).json()
        original_md = pre["current_matchday"]

        try:
            r = session.post(f"{API}/system/matchday", json={"matchday": 5},
                             headers=auth_headers(admin_token))
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["ok"] is True
            assert body["current_matchday"] == 5

            g = session.get(f"{API}/system", headers=auth_headers(user1["token"]))
            assert g.status_code == 200
            assert g.json()["current_matchday"] == 5
        finally:
            # Restore
            session.post(f"{API}/system/matchday", json={"matchday": original_md},
                         headers=auth_headers(admin_token))

    def test_invalid_matchday_zero_returns_422(self, session, admin_token):
        r = session.post(f"{API}/system/matchday", json={"matchday": 0},
                         headers=auth_headers(admin_token))
        assert r.status_code == 422, r.text

    def test_invalid_matchday_39_returns_422(self, session, admin_token):
        r = session.post(f"{API}/system/matchday", json={"matchday": 39},
                         headers=auth_headers(admin_token))
        assert r.status_code == 422, r.text


# ---------------- POST /api/system/scheduler ----------------
class TestSetSchedulerEnabled:
    def test_non_admin_gets_403(self, session, user1):
        r = session.post(f"{API}/system/scheduler", json={"enabled": False},
                         headers=auth_headers(user1["token"]))
        assert r.status_code == 403, r.text

    def test_admin_can_disable_and_enable(self, session, admin_token, user1):
        pre = session.get(f"{API}/system", headers=auth_headers(user1["token"])).json()
        original = pre["scheduler_enabled"]

        try:
            r = session.post(f"{API}/system/scheduler", json={"enabled": False},
                             headers=auth_headers(admin_token))
            assert r.status_code == 200, r.text
            assert r.json()["scheduler_enabled"] is False
            g = session.get(f"{API}/system", headers=auth_headers(user1["token"]))
            assert g.json()["scheduler_enabled"] is False

            r2 = session.post(f"{API}/system/scheduler", json={"enabled": True},
                              headers=auth_headers(admin_token))
            assert r2.status_code == 200
            assert r2.json()["scheduler_enabled"] is True
        finally:
            session.post(f"{API}/system/scheduler", json={"enabled": bool(original)},
                         headers=auth_headers(admin_token))


# ---------------- POST /api/system/sync-now ----------------
class TestSyncNow:
    def test_non_admin_gets_403(self, session, user1):
        r = session.post(f"{API}/system/sync-now", headers=auth_headers(user1["token"]))
        assert r.status_code == 403, r.text

    def test_admin_gets_400_apifootball_suspended(self, session, admin_token):
        r = session.post(f"{API}/system/sync-now", headers=auth_headers(admin_token))
        # api-football account suspended -> expect 400.
        # In the current seed the players collection has NO external_id, so the
        # endpoint fails earlier with "La rosa non e sincronizzata..." (also 400).
        # Either 400 message is acceptable as long as we do NOT get a 200 sync.
        assert r.status_code == 400, f"expected 400 got {r.status_code} {r.text}"
        detail = r.json().get("detail", "")
        assert (
            detail.startswith("API-Football:")
            or "rosa non e sincronizzata" in detail.lower()
            or "api_football_key" in detail.lower()
        ), f"unexpected detail: {detail}"


# ---------------- api_votes fallback via /leagues/{id}/results/{md} ----------------
class TestApiVotesFallback:
    """
    Register two users, user A creates a league, B joins.
    Both submit lineups with empty bench. No league-specific votes are submitted.
    Insert ONE api_votes row for one of A's starters and verify:
      - A's total == that fantavoto
      - B's total == 0
    Clean up api_votes doc afterward.
    """

    def test_api_votes_used_when_no_league_votes(self, session, admin_token):
        # Create fresh, isolated users to avoid interfering with existing shared-state class
        suffix = uuid.uuid4().hex[:8]
        rA = session.post(f"{API}/auth/register", json={
            "email": f"TEST_apiv_A_{suffix}@t.com", "password": "Passw0rd!",
            "username": f"TESTapivA{suffix}",
        })
        assert rA.status_code == 201, rA.text
        tokA = rA.json()["access_token"]

        rB = session.post(f"{API}/auth/register", json={
            "email": f"TEST_apiv_B_{suffix}@t.com", "password": "Passw0rd!",
            "username": f"TESTapivB{suffix}",
        })
        assert rB.status_code == 201, rB.text
        tokB = rB.json()["access_token"]

        # A creates league
        lg = session.post(f"{API}/leagues", json={"name": f"TEST_apiv_{suffix}"},
                          headers=auth_headers(tokA))
        assert lg.status_code == 200, lg.text
        league = lg.json()
        # B joins
        j = session.post(f"{API}/leagues/join", json={"code": league["code"]},
                         headers=auth_headers(tokB))
        assert j.status_code == 200, j.text

        # Fetch players
        pr = session.get(f"{API}/players", headers=auth_headers(admin_token))
        players = pr.json()
        # Disjoint slices for A and B
        starters_A = [p["id"] for p in players[:11]]
        starters_B = [p["id"] for p in players[50:61]]
        assert len(set(starters_A) & set(starters_B)) == 0

        # Use a matchday that is unlikely to have api_votes from a real sync
        matchday = 33

        lA = session.post(f"{API}/leagues/{league['id']}/lineups",
                          json={"matchday": matchday, "module": "4-3-3",
                                "starters": starters_A, "bench": []},
                          headers=auth_headers(tokA))
        assert lA.status_code == 200, lA.text

        lB = session.post(f"{API}/leagues/{league['id']}/lineups",
                          json={"matchday": matchday, "module": "3-5-2",
                                "starters": starters_B, "bench": []},
                          headers=auth_headers(tokB))
        assert lB.status_code == 200, lB.text

        # Insert one api_votes row directly for starters_A[0] with fantavoto 8.0
        target_player = starters_A[0]
        FANTAVOTO = 8.0

        try:
            _mongo_upsert_api_vote(matchday, target_player, {
                "matchday": matchday,
                "player_id": target_player,
                "voto": 8.0,
                "fantavoto": FANTAVOTO,
                "gol": 0, "assist": 0,
            })

            # GET results for that matchday
            rr = session.get(f"{API}/leagues/{league['id']}/results/{matchday}",
                             headers=auth_headers(tokA))
            assert rr.status_code == 200, rr.text
            data = rr.json()
            assert data["matchday"] == matchday
            # Find rows by username
            userA_row = next(x for x in data["results"] if x["user_id"] and
                             starters_A[0] in [b["player_id"] for b in x["breakdown"]])
            userB_row = next(x for x in data["results"] if x["user_id"] and
                             starters_B[0] in [b["player_id"] for b in x["breakdown"]])
            # A total should equal exactly FANTAVOTO (only one starter has a vote)
            assert userA_row["total"] == FANTAVOTO, f"A total {userA_row['total']} != {FANTAVOTO}"
            # B total should be 0 (no votes, no api_votes for its starters)
            assert userB_row["total"] == 0, f"B total {userB_row['total']} != 0"
            # Verify breakdown for A: exactly one starter has has_vote=True and fantavoto=8.0
            a_hits = [b for b in userA_row["breakdown"] if b.get("has_vote")]
            assert len(a_hits) == 1
            assert a_hits[0]["player_id"] == target_player
            assert a_hits[0]["fantavoto"] == FANTAVOTO
            # Verify no substitutions occurred (bench empty)
            assert userA_row["substitutions"] == []
        finally:
            # Cleanup: remove the api_votes doc we inserted
            _mongo_delete_api_vote(matchday, target_player)
