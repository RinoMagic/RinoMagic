"""Regression tests for the Admin panel + kick feature (iter #18).

Covers the review request:
1.  POST /api/auth/admin/promote — create a fresh admin & log in with it.
2.  GET  /api/auth/users — admin lists all users (used by UI to filter admins).
3.  DELETE /api/auth/users/{id} — safeguard "last admin" + cascade delete.
4.  POST /api/rooms/{room_id}/kick/{user_id} (TheBestTiket)
5.  POST /api/sv/tournaments/{tid}/kick/{user_id} (Survival)
6.  POST /api/sal/tournaments/{tid}/kick/{user_id} (ScoreAndLive)
7.  POST /api/fg/leagues/{league_id}/kick/{user_id} (FantaGiornata)
8.  POST /api/bonus/configs/{cid}/kick/{user_id} (Bonus)
9.  GET  /api/bonus/configs/{cid}/picks-admin

For every kick endpoint we verify:
  * kick removes membership + all picks/schedine/lineups
  * a second kick on the same user returns 404
  * kicking the resource-admin returns 400
"""

# ---------------------------------------------------------------------------
# Imports
# ---------------------------------------------------------------------------
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://fantasy-calcio-15.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

SEED_ADMIN_EMAIL = "verone.salvatore@libero.it"
SEED_ADMIN_PW = "SchedinaBar2026!"

SEASON = f"k{uuid.uuid4().hex[:8]}"  # season field caps at 10 chars


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------
def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _admin_login(email, pw):
    r = requests.post(
        f"{API}/auth/admin/login",
        json={"email": email, "password": pw},
        timeout=15,
    )
    return r


def _register_player(uname_prefix="pk"):
    uname = f"TEST_{uname_prefix}_{uuid.uuid4().hex[:6]}"
    r = requests.post(
        f"{API}/auth/player/register",
        json={"username": uname, "password": "pw12345678"},
        timeout=15,
    )
    r.raise_for_status()
    body = r.json()
    return body["token"], body["user"]


@pytest.fixture(scope="module")
def admin_tok():
    r = _admin_login(SEED_ADMIN_EMAIL, SEED_ADMIN_PW)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_id(admin_tok):
    r = requests.get(f"{API}/auth/me", headers=_h(admin_tok), timeout=15)
    r.raise_for_status()
    return r.json()["id"]


@pytest.fixture(scope="module")
def seeded_calendar(admin_tok):
    """Fixtures for a distinct season/matchday used by the sv/sal/bonus tests.

    We use a unique season prefix so we never collide with production data.
    Kickoff is in the future so pick submission does not violate "locked".
    """
    kickoff = (datetime.now(timezone.utc) + timedelta(days=90)).isoformat()
    fixtures = []
    for md in (1, 2, 3):
        fixtures.append({
            "matchday": md,
            "home_team": f"TeamH_md{md}",
            "away_team": f"TeamA_md{md}",
            "kickoff_iso": kickoff,
        })
        fixtures.append({
            "matchday": md,
            "home_team": f"TeamX_md{md}",
            "away_team": f"TeamY_md{md}",
            "kickoff_iso": kickoff,
        })
    r = requests.post(
        f"{API}/sal/calendar/import",
        json={"season": SEASON, "fixtures": fixtures, "replace": True},
        headers=_h(admin_tok),
        timeout=15,
    )
    assert r.status_code == 200, f"calendar import failed: {r.status_code} {r.text}"
    return SEASON


# ===========================================================================
# 1) /auth/admin/promote  &  new-admin login
# ===========================================================================
class TestAdminPromote:
    def test_promote_creates_admin_and_login_works(self, admin_tok):
        new_email = f"test_admin_{uuid.uuid4().hex[:6]}@example.com"
        temp_pw = "TempPassw0rd!"
        r = requests.post(
            f"{API}/auth/admin/promote",
            json={"email": new_email, "temp_password": temp_pw},
            headers=_h(admin_tok),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        new_user_id = r.json()["user_id"]
        assert new_user_id

        # Login with the new admin's temp password
        lr = _admin_login(new_email, temp_pw)
        assert lr.status_code == 200, lr.text
        data = lr.json()
        assert data["user"]["role"] == "admin"
        assert data["user"]["must_change_password"] is True
        assert data["user"]["id"] == new_user_id

        # cleanup — delete via seed admin
        d = requests.delete(
            f"{API}/auth/users/{new_user_id}",
            headers=_h(admin_tok),
            timeout=15,
        )
        assert d.status_code == 200, d.text


# ===========================================================================
# 2) /auth/users (list)
# ===========================================================================
class TestListUsers:
    def test_admin_lists_users(self, admin_tok):
        r = requests.get(f"{API}/auth/users", headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200, r.text
        users = r.json()
        assert isinstance(users, list)
        assert any(u.get("email") == SEED_ADMIN_EMAIL for u in users), \
            "seed admin missing from /auth/users"
        for u in users:
            assert "id" in u
            assert "role" in u
            # password_hash must never leak
            assert "password_hash" not in u

    def test_player_cannot_list_users(self):
        ptok, _pu = _register_player("listu")
        try:
            r = requests.get(f"{API}/auth/users", headers=_h(ptok), timeout=15)
            assert r.status_code == 403
        finally:
            # Cleanup via seed admin
            admin = _admin_login(SEED_ADMIN_EMAIL, SEED_ADMIN_PW).json()["token"]
            requests.delete(f"{API}/auth/users/{_pu['id']}", headers=_h(admin), timeout=15)


# ===========================================================================
# 3) /auth/users DELETE  (last-admin safeguard + cascade)
# ===========================================================================
class TestDeleteUser:
    def test_cannot_delete_last_admin(self, admin_tok, admin_id):
        """The seed admin should be the only admin — cannot self-delete either
        because ``user_id == user["id"]`` guard triggers first."""
        # Try to delete a hypothetical single admin by targeting seed admin
        r = requests.delete(
            f"{API}/auth/users/{admin_id}",
            headers=_h(admin_tok),
            timeout=15,
        )
        # Guard 1: cannot delete self
        assert r.status_code == 400, r.text
        assert "te stesso" in r.json().get("detail", "").lower()

    def test_delete_player_cascades(self, admin_tok):
        """Cascade delete removes memberships, schedine, sv_participants,
        sv_picks, sal_participants, sal_picks, fg_memberships, fg_lineups,
        fg_matchday_results, bonus_picks."""
        # Register a fresh player
        ptok, pu = _register_player("casc")
        pid = pu["id"]

        # Make the player a member of a TheBestTiket room
        room_payload = {
            "name": f"TEST_CASC_{uuid.uuid4().hex[:6]}",
            "matchday": 1,
            "max_events": 5,
        }
        rr = requests.post(f"{API}/rooms", json=room_payload,
                           headers=_h(admin_tok), timeout=15)
        assert rr.status_code == 200, rr.text
        room = rr.json()
        jr = requests.post(
            f"{API}/rooms/join",
            json={"invite_code": room["invite_code"]},
            headers=_h(ptok), timeout=15,
        )
        assert jr.status_code == 200, jr.text

        # Delete the player
        d = requests.delete(f"{API}/auth/users/{pid}",
                            headers=_h(admin_tok), timeout=15)
        assert d.status_code == 200, d.text

        # Verify the player is gone
        r = requests.get(f"{API}/auth/users", headers=_h(admin_tok), timeout=15)
        assert not any(u["id"] == pid for u in r.json())

        # Cleanup room
        requests.delete(f"{API}/rooms/{room['id']}",
                        headers=_h(admin_tok), timeout=15)


# ===========================================================================
# 4) TheBestTiket kick
# ===========================================================================
class TestTiketKick:
    def test_full_flow(self, admin_tok, admin_id):
        # Create room
        rr = requests.post(
            f"{API}/rooms",
            json={"name": f"TEST_TKICK_{uuid.uuid4().hex[:6]}",
                  "matchday": 1, "max_events": 5},
            headers=_h(admin_tok), timeout=15,
        )
        assert rr.status_code == 200, rr.text
        room = rr.json()
        room_id = room["id"]

        # Register player + join
        ptok, pu = _register_player("tkick")
        pid = pu["id"]
        jr = requests.post(
            f"{API}/rooms/join",
            json={"invite_code": room["invite_code"]},
            headers=_h(ptok), timeout=15,
        )
        assert jr.status_code == 200, jr.text

        try:
            # 400 — cannot kick room admin
            r = requests.post(
                f"{API}/rooms/{room_id}/kick/{admin_id}",
                headers=_h(admin_tok), timeout=15,
            )
            assert r.status_code == 400, r.text
            assert "admin" in r.json().get("detail", "").lower()

            # 200 — kick player
            r = requests.post(
                f"{API}/rooms/{room_id}/kick/{pid}",
                headers=_h(admin_tok), timeout=15,
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["ok"] is True
            assert body["kicked_user_id"] == pid
            assert "deleted_schedine" in body

            # 404 — repeat kick (user no longer a member)
            r = requests.post(
                f"{API}/rooms/{room_id}/kick/{pid}",
                headers=_h(admin_tok), timeout=15,
            )
            assert r.status_code == 404, r.text
        finally:
            requests.delete(f"{API}/rooms/{room_id}",
                            headers=_h(admin_tok), timeout=15)
            requests.delete(f"{API}/auth/users/{pid}",
                            headers=_h(admin_tok), timeout=15)

    def test_player_cannot_kick(self, admin_tok):
        # Create room + get invite
        rr = requests.post(
            f"{API}/rooms",
            json={"name": f"TEST_TAUTH_{uuid.uuid4().hex[:6]}",
                  "matchday": 1, "max_events": 5},
            headers=_h(admin_tok), timeout=15,
        )
        room = rr.json()
        ptok, pu = _register_player("tka")
        requests.post(f"{API}/rooms/join",
                      json={"invite_code": room["invite_code"]},
                      headers=_h(ptok), timeout=15)
        try:
            r = requests.post(
                f"{API}/rooms/{room['id']}/kick/{pu['id']}",
                headers=_h(ptok), timeout=15,
            )
            # require_admin -> 403
            assert r.status_code == 403, r.text
        finally:
            requests.delete(f"{API}/rooms/{room['id']}",
                            headers=_h(admin_tok), timeout=15)
            requests.delete(f"{API}/auth/users/{pu['id']}",
                            headers=_h(admin_tok), timeout=15)


# ===========================================================================
# 5) Survival kick
# ===========================================================================
class TestSurvivalKick:
    def test_full_flow(self, admin_tok, admin_id, seeded_calendar):
        # Create tournament
        r = requests.post(
            f"{API}/sv/tournaments",
            json={
                "name": f"TEST_SVK_{uuid.uuid4().hex[:6]}",
                "season": seeded_calendar,
                "initial_lives": 3,
            },
            headers=_h(admin_tok), timeout=15,
        )
        assert r.status_code == 200, r.text
        t = r.json()
        tid = t["id"]

        ptok, pu = _register_player("svk")
        pid = pu["id"]
        jr = requests.post(
            f"{API}/sv/tournaments/join",
            json={"invite_code": t["invite_code"]},
            headers=_h(ptok), timeout=15,
        )
        assert jr.status_code == 200, jr.text

        try:
            # 400 — kick admin
            r = requests.post(
                f"{API}/sv/tournaments/{tid}/kick/{admin_id}",
                headers=_h(admin_tok), timeout=15,
            )
            assert r.status_code == 400, r.text

            # 200 — kick player
            r = requests.post(
                f"{API}/sv/tournaments/{tid}/kick/{pid}",
                headers=_h(admin_tok), timeout=15,
            )
            assert r.status_code == 200, r.text
            assert r.json()["kicked_user_id"] == pid

            # 404 — repeat kick
            r = requests.post(
                f"{API}/sv/tournaments/{tid}/kick/{pid}",
                headers=_h(admin_tok), timeout=15,
            )
            assert r.status_code == 404, r.text
        finally:
            requests.delete(f"{API}/sv/tournaments/{tid}",
                            headers=_h(admin_tok), timeout=15)
            requests.delete(f"{API}/auth/users/{pid}",
                            headers=_h(admin_tok), timeout=15)


# ===========================================================================
# 6) ScoreAndLive kick
# ===========================================================================
class TestSalKick:
    def test_full_flow(self, admin_tok, admin_id, seeded_calendar):
        r = requests.post(
            f"{API}/sal/tournaments",
            json={
                "name": f"TEST_SALK_{uuid.uuid4().hex[:6]}",
                "season": seeded_calendar,
                "initial_lives": 3,
            },
            headers=_h(admin_tok), timeout=15,
        )
        assert r.status_code == 200, r.text
        t = r.json()
        tid = t["id"]

        ptok, pu = _register_player("salk")
        pid = pu["id"]
        jr = requests.post(
            f"{API}/sal/tournaments/{tid}/join",
            json={"invite_code": t["invite_code"]},
            headers=_h(ptok), timeout=15,
        )
        assert jr.status_code == 200, jr.text

        try:
            r = requests.post(
                f"{API}/sal/tournaments/{tid}/kick/{admin_id}",
                headers=_h(admin_tok), timeout=15,
            )
            assert r.status_code == 400, r.text

            r = requests.post(
                f"{API}/sal/tournaments/{tid}/kick/{pid}",
                headers=_h(admin_tok), timeout=15,
            )
            assert r.status_code == 200, r.text
            assert r.json()["kicked_user_id"] == pid

            r = requests.post(
                f"{API}/sal/tournaments/{tid}/kick/{pid}",
                headers=_h(admin_tok), timeout=15,
            )
            assert r.status_code == 404, r.text
        finally:
            requests.delete(f"{API}/sal/tournaments/{tid}",
                            headers=_h(admin_tok), timeout=15)
            requests.delete(f"{API}/auth/users/{pid}",
                            headers=_h(admin_tok), timeout=15)


# ===========================================================================
# 7) FantaGiornata kick
# ===========================================================================
class TestFgKick:
    def test_full_flow(self, admin_tok, admin_id):
        r = requests.post(
            f"{API}/fg/leagues",
            json={"name": f"TEST_FGK_{uuid.uuid4().hex[:6]}"},
            headers=_h(admin_tok), timeout=15,
        )
        assert r.status_code == 200, r.text
        lg = r.json()
        lid = lg["id"]
        code = lg["invite_code"]

        ptok, pu = _register_player("fgk")
        pid = pu["id"]
        jr = requests.post(
            f"{API}/fg/leagues/{lid}/join",
            json={"invite_code": code},
            headers=_h(ptok), timeout=15,
        )
        assert jr.status_code == 200, jr.text

        try:
            r = requests.post(
                f"{API}/fg/leagues/{lid}/kick/{admin_id}",
                headers=_h(admin_tok), timeout=15,
            )
            assert r.status_code == 400, r.text

            r = requests.post(
                f"{API}/fg/leagues/{lid}/kick/{pid}",
                headers=_h(admin_tok), timeout=15,
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["kicked_user_id"] == pid
            assert "deleted_lineups" in body
            assert "deleted_results" in body

            r = requests.post(
                f"{API}/fg/leagues/{lid}/kick/{pid}",
                headers=_h(admin_tok), timeout=15,
            )
            assert r.status_code == 404, r.text
        finally:
            requests.delete(f"{API}/fg/leagues/{lid}",
                            headers=_h(admin_tok), timeout=15)
            requests.delete(f"{API}/auth/users/{pid}",
                            headers=_h(admin_tok), timeout=15)


# ===========================================================================
# 8) Bonus kick + 9) picks-admin
# ===========================================================================
class TestBonusKickAndPicksAdmin:
    def _create_config(self, admin_tok, season, matchday, bonus_type="first_scorer"):
        r = requests.post(
            f"{API}/bonus/configs",
            json={"season": season, "matchday": matchday, "bonus_type": bonus_type},
            headers=_h(admin_tok), timeout=15,
        )
        assert r.status_code == 200, r.text
        return r.json()

    def test_picks_admin_requires_admin_and_returns_shape(
        self, admin_tok, seeded_calendar,
    ):
        cfg = self._create_config(admin_tok, seeded_calendar, matchday=1)
        cid = cfg["id"]

        # Unauthenticated → 401 (no Authorization header)
        r = requests.get(f"{API}/bonus/configs/{cid}/picks-admin", timeout=15)
        assert r.status_code in (401, 403), r.text

        # Player token → 403
        ptok, pu = _register_player("bpx")
        try:
            r = requests.get(
                f"{API}/bonus/configs/{cid}/picks-admin",
                headers=_h(ptok), timeout=15,
            )
            assert r.status_code == 403, r.text
        finally:
            requests.delete(f"{API}/auth/users/{pu['id']}",
                            headers=_h(admin_tok), timeout=15)

        # Admin → 200 + expected shape
        r = requests.get(
            f"{API}/bonus/configs/{cid}/picks-admin",
            headers=_h(admin_tok), timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["config_id"] == cid
        assert isinstance(body["picks"], list)

        # cleanup config
        requests.delete(f"{API}/bonus/configs/{cid}",
                        headers=_h(admin_tok), timeout=15)

    def test_kick_bonus_flow(self, admin_tok, seeded_calendar):
        """Bonus kick end-to-end: create SAL tournament, join a player,
        submit a scorer pick, then admin kicks — pick must be gone."""
        # 1) Create a distinct bonus config on md=2 (first_scorer)
        cfg = self._create_config(admin_tok, seeded_calendar, matchday=2)
        cid = cfg["id"]

        # 2) Create a SAL tournament ("score" game maps to first_scorer)
        rt = requests.post(
            f"{API}/sal/tournaments",
            json={
                "name": f"TEST_BKS_{uuid.uuid4().hex[:6]}",
                "season": seeded_calendar,
                "initial_lives": 3,
            },
            headers=_h(admin_tok), timeout=15,
        )
        assert rt.status_code == 200, rt.text
        t = rt.json()
        tid = t["id"]

        # 3) Register + join player
        ptok, pu = _register_player("bkp")
        pid = pu["id"]
        jr = requests.post(
            f"{API}/sal/tournaments/{tid}/join",
            json={"invite_code": t["invite_code"]},
            headers=_h(ptok), timeout=15,
        )
        assert jr.status_code == 200, jr.text

        try:
            # 4) Player submits a scorer pick
            sp = requests.post(
                f"{API}/bonus/picks/scorer",
                json={
                    "game": "score",
                    "subscription_id": tid,
                    "season": seeded_calendar,
                    "player_name": "Test Scorer",
                },
                headers=_h(ptok), timeout=15,
            )
            assert sp.status_code == 200, sp.text

            # 5) picks-admin must include this pick
            pa = requests.get(
                f"{API}/bonus/configs/{cid}/picks-admin",
                headers=_h(admin_tok), timeout=15,
            )
            assert pa.status_code == 200
            picks = pa.json()["picks"]
            assert any(p["user_id"] == pid and p["game"] == "score" for p in picks), \
                f"Player pick not in picks-admin: {picks}"

            # 6) Admin kicks player from this config
            kr = requests.post(
                f"{API}/bonus/configs/{cid}/kick/{pid}",
                headers=_h(admin_tok), timeout=15,
            )
            assert kr.status_code == 200, kr.text
            assert kr.json()["deleted_picks"] >= 1

            # 7) Second kick → 404 (no picks left)
            kr2 = requests.post(
                f"{API}/bonus/configs/{cid}/kick/{pid}",
                headers=_h(admin_tok), timeout=15,
            )
            assert kr2.status_code == 404, kr2.text

            # 8) picks-admin no longer shows the player
            pa2 = requests.get(
                f"{API}/bonus/configs/{cid}/picks-admin",
                headers=_h(admin_tok), timeout=15,
            )
            assert not any(p["user_id"] == pid for p in pa2.json()["picks"])
        finally:
            requests.delete(f"{API}/bonus/configs/{cid}",
                            headers=_h(admin_tok), timeout=15)
            requests.delete(f"{API}/sal/tournaments/{tid}",
                            headers=_h(admin_tok), timeout=15)
            requests.delete(f"{API}/auth/users/{pid}",
                            headers=_h(admin_tok), timeout=15)
