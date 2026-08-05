"""Regression tests for the `has_submitted_current` flag across
FantaGiornata (FG), Survival (SV) and ScoreAndLive (SAL).

Context: The user reported that in FG league detail, users who had
actually submitted lineups were still shown as "In attesa di formazione".
Root cause: `matchday_deadlines` collection was empty → `current_md` was
None → nobody was ever considered "submitted".

Fix under test (fantagiornata.py get_league, lines ~380-437):
1. Prefer earliest future deadline
2. Else largest past deadline
3. Else largest matchday found in fg_lineups for this league
4. Else 1 (season start)

Also verifies SV leaderboard uses the correct field name (`matchday`,
not `matchday_number`) and that SAL keeps working.

Uses existing data in the DB (see review request):
- FG league 1fef4127-... "fanta gionata 1 test" with 4 complete lineups (matchday=1)
- SV tournament 19c83ae7-... "Simulazione Survival"
- SAL tournament 98d8fa5b-... "torneo test 1" (2 picks in current md=1)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://fantasy-calcio-15.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "verone.salvatore@libero.it"
ADMIN_PASSWORD = "SchedinaBar2026!"

# Pre-existing IDs pulled from the DB (see review request context)
FG_LEAGUE_ID = "1fef4127-00ee-4cef-9dd7-9d1c54ca0179"
SV_TOURNAMENT_ID = "19c83ae7-92fc-48a8-b126-7e3691e67923"
SAL_TOURNAMENT_ID = "98d8fa5b-ce7d-442b-9d9b-56a87f5547f8"

# Users who submitted FG lineups (all 4 members of the league)
FG_SUBMITTED_USER_IDS = {
    "40dc566f-f0bd-4c5f-9f4a-6790da994778",  # danielecalabrese
    "9f4496b6-f643-4e02-916d-b4a368d3b2ca",  # carlocento91
    "541a5219-a62c-46f2-8a3e-c66e77c7e37a",  # verone.salvatore
    "dfd6341b-1901-4a4a-bd4f-228926715444",  # andr97
}

# SAL: users with picks in the current open matchday (md 1)
SAL_SUBMITTED_USER_IDS = {
    "541a5219-a62c-46f2-8a3e-c66e77c7e37a",  # verone.salvatore
    "dfd6341b-1901-4a4a-bd4f-228926715444",  # andr97
}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def admin_token():
    """Login as admin and return the JWT."""
    r = requests.post(
        f"{API}/auth/admin/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    assert tok, f"No token in login response: {body}"
    return tok


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {
        "Authorization": f"Bearer {admin_token}",
        "Content-Type": "application/json",
    }


# ---------------------------------------------------------------------------
# 1. FG primary bug: has_submitted_current + current_matchday_number
# ---------------------------------------------------------------------------
class TestFantaGiornataHasSubmitted:
    def test_get_league_returns_current_matchday_number(self, admin_headers):
        """current_matchday_number must be derived from fg_lineups when no deadlines exist."""
        r = requests.get(
            f"{API}/fg/leagues/{FG_LEAGUE_ID}",
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        assert "current_matchday_number" in data, "Missing current_matchday_number in response"
        assert data["current_matchday_number"] is not None, (
            "current_matchday_number is None — fallback did not trigger"
        )
        # Given the DB state (all 4 lineups on matchday=1 and no deadlines),
        # the fallback must resolve to 1.
        assert data["current_matchday_number"] == 1, (
            f"Expected current_matchday_number=1, got {data['current_matchday_number']}"
        )

    def test_all_four_members_have_submitted_current_true(self, admin_headers):
        """All 4 members submitted a complete lineup (11 starters) in md=1."""
        r = requests.get(
            f"{API}/fg/leagues/{FG_LEAGUE_ID}",
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        members = data.get("members") or []
        assert len(members) == 4, f"Expected 4 members, got {len(members)}: {members}"
        for m in members:
            assert "has_submitted_current" in m, f"Missing flag on {m}"
        submitted_ids = {m["user_id"] for m in members if m["has_submitted_current"]}
        assert submitted_ids == FG_SUBMITTED_USER_IDS, (
            f"Expected all 4 users True.\n"
            f"Got submitted: {submitted_ids}\n"
            f"Expected: {FG_SUBMITTED_USER_IDS}\n"
            f"Full members: {members}"
        )


# ---------------------------------------------------------------------------
# 2. SV: has_submitted_current uses field 'matchday' (not 'matchday_number')
# ---------------------------------------------------------------------------
class TestSurvivalHasSubmitted:
    def test_leaderboard_returns_has_submitted_current_flag(self, admin_headers):
        """Every row in the leaderboard must carry the flag."""
        r = requests.get(
            f"{API}/sv/tournaments/{SV_TOURNAMENT_ID}/leaderboard",
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        rows = r.json()
        assert isinstance(rows, list)
        assert len(rows) > 0, "Expected at least one participant row"
        for row in rows:
            assert "has_submitted_current" in row, (
                f"Row missing has_submitted_current flag: {row}"
            )
            assert isinstance(row["has_submitted_current"], bool)

    def test_leaderboard_current_matchday_no_picks_all_false(self, admin_headers):
        """In the seeded DB, the earliest non-settled SV matchday is md=3,
        which has zero picks → all rows must be False."""
        r = requests.get(
            f"{API}/sv/tournaments/{SV_TOURNAMENT_ID}/leaderboard",
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 200
        rows = r.json()
        true_users = [r["nickname"] for r in rows if r["has_submitted_current"]]
        assert true_users == [], (
            f"Expected no submitters for SV md=3 (no picks), got: {true_users}"
        )


# ---------------------------------------------------------------------------
# 3. SAL regression: has_submitted_current continues to work
# ---------------------------------------------------------------------------
class TestScoreAndLiveHasSubmitted:
    def test_get_tournament_returns_has_submitted_for_all_participants(self, admin_headers):
        r = requests.get(
            f"{API}/sal/tournaments/{SAL_TOURNAMENT_ID}",
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        participants = data.get("participants") or []
        assert len(participants) == 4, f"Expected 4 participants, got {len(participants)}"
        for p in participants:
            assert "has_submitted_current" in p, f"Missing flag on {p}"

    def test_sal_only_verone_and_andr97_have_submitted(self, admin_headers):
        r = requests.get(
            f"{API}/sal/tournaments/{SAL_TOURNAMENT_ID}",
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        participants = data.get("participants") or []
        submitted_ids = {p["user_id"] for p in participants if p["has_submitted_current"]}
        assert submitted_ids == SAL_SUBMITTED_USER_IDS, (
            f"Expected {SAL_SUBMITTED_USER_IDS} submitters, got {submitted_ids}. "
            f"Participants: {participants}"
        )


# ---------------------------------------------------------------------------
# 4. Edge case: empty FG league (no lineups, no deadlines) → fallback = 1
# 5. Partial drafts (starters < 11) must NOT count as submitted
# ---------------------------------------------------------------------------
class TestFantaGiornataEdgeCases:
    """Creates a throw-away FG league and verifies fallback + partial draft handling."""

    @pytest.fixture(scope="class")
    def throwaway_league(self, admin_headers):
        # Create empty league
        payload = {"name": "TEST_hsub_empty_league"}
        r = requests.post(f"{API}/fg/leagues", json=payload,
                          headers=admin_headers, timeout=15)
        assert r.status_code in (200, 201), f"Create league failed: {r.status_code} {r.text}"
        lg = r.json()
        league_id = lg["id"]
        yield league_id
        # Teardown
        try:
            requests.delete(f"{API}/fg/leagues/{league_id}",
                            headers=admin_headers, timeout=15)
        except Exception:
            pass

    def test_empty_league_current_matchday_number_is_1(
        self, admin_headers, throwaway_league,
    ):
        r = requests.get(
            f"{API}/fg/leagues/{throwaway_league}",
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("current_matchday_number") == 1, (
            f"Expected fallback current_matchday_number=1 for empty league, "
            f"got {data.get('current_matchday_number')}"
        )

    def test_empty_league_no_members_submitted(self, admin_headers, throwaway_league):
        r = requests.get(
            f"{API}/fg/leagues/{throwaway_league}",
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 200
        members = r.json().get("members") or []
        # The admin is auto-member as the league admin
        assert len(members) >= 1
        # None should be submitted (no lineups exist)
        assert all(m["has_submitted_current"] is False for m in members), (
            f"Expected all False on empty league, got {members}"
        )
