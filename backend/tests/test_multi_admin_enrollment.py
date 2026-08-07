"""
Multi-admin auto-enrollment tests.
Covers the two-way behavior:
  A) Creating a room/tournament/league auto-enrolls ALL existing admins.
  B) Promoting a new admin retroactively enrolls them into ALL open objects.
Also verifies both admins can create invites regardless of who created the object.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")

ADMIN1_EMAIL = "verone.salvatore@libero.it"
ADMIN1_PASSWORD = "SchedinaBar2026!"
ADMIN2_EMAIL = "testadmin2@rinomagic.io"
ADMIN2_TEMP_PASSWORD = "TestPass2026!"
ADMIN2_NEW_PASSWORD = "TestPass2027!"


# ---------------- helpers ----------------
def _admin_login(email: str, password: str):
    r = requests.post(
        f"{BASE_URL}/api/auth/admin/login",
        json={"email": email, "password": password},
        timeout=30,
    )
    return r


def _headers(token: str):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------------- shared state ----------------
STATE: dict = {}


# ---------------- Tests (ordered) ----------------
class TestMultiAdminEnrollment:

    # ----- TEST 1: Login admin1 + promote admin2 -----
    def test_01_login_admin1_and_promote_admin2(self):
        r = _admin_login(ADMIN1_EMAIL, ADMIN1_PASSWORD)
        assert r.status_code == 200, f"admin1 login failed: {r.status_code} {r.text}"
        body = r.json()
        STATE["admin1_token"] = body["token"]
        STATE["admin1_id"] = body["user"]["id"]

        # Best-effort cleanup in case a prior failed run left admin2 around
        # (we don't fail if it doesn't exist).
        users_resp = requests.get(
            f"{BASE_URL}/api/auth/users",
            headers=_headers(STATE["admin1_token"]),
            timeout=30,
        )
        if users_resp.status_code == 200:
            for u in users_resp.json():
                if (u.get("email") or "").lower() == ADMIN2_EMAIL:
                    requests.delete(
                        f"{BASE_URL}/api/auth/users/{u['id']}",
                        headers=_headers(STATE["admin1_token"]),
                        timeout=30,
                    )

        # Now promote a fresh admin2
        r = requests.post(
            f"{BASE_URL}/api/auth/admin/promote",
            json={"email": ADMIN2_EMAIL, "temp_password": ADMIN2_TEMP_PASSWORD},
            headers=_headers(STATE["admin1_token"]),
            timeout=30,
        )
        assert r.status_code == 200, f"promote failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True
        assert "enrolled" in body and isinstance(body["enrolled"], dict), (
            f"missing/invalid enrolled dict: {body}"
        )
        for k in ("tiket", "surviva", "scoreandlive", "fantagiornata"):
            assert k in body["enrolled"], f"missing counter '{k}' in {body['enrolled']}"
        STATE["admin2_id"] = body["user_id"]
        STATE["enrolled_counters"] = body["enrolled"]
        print(f"Enrolled counters on promote: {body['enrolled']}")

    # ----- TEST 2: admin1 creates 4 objects (should auto-enroll admin2 via forward path) -----
    def test_02_admin1_creates_four_objects(self):
        assert "admin1_token" in STATE, "admin1 must be logged in"
        h = _headers(STATE["admin1_token"])

        # Room
        r = requests.post(
            f"{BASE_URL}/api/rooms",
            json={"name": "TEST_MultiAdmin Test Room", "matchday": 5, "max_events": 3},
            headers=h, timeout=30,
        )
        assert r.status_code == 200, f"create room failed: {r.status_code} {r.text}"
        STATE["room_id"] = r.json()["id"]

        # SV tournament
        r = requests.post(
            f"{BASE_URL}/api/sv/tournaments",
            json={"name": "TEST_MultiAdmin SV", "season": "2026-27",
                  "initial_lives": 10, "start_matchday": 5},
            headers=h, timeout=30,
        )
        assert r.status_code == 200, f"create sv failed: {r.status_code} {r.text}"
        STATE["sv_id"] = r.json()["id"]

        # SAL tournament
        r = requests.post(
            f"{BASE_URL}/api/sal/tournaments",
            json={"name": "TEST_MultiAdmin SAL", "season": "2026-27",
                  "initial_lives": 10, "start_matchday": 5},
            headers=h, timeout=30,
        )
        assert r.status_code == 200, f"create sal failed: {r.status_code} {r.text}"
        STATE["sal_id"] = r.json()["id"]

        # FG league
        r = requests.post(
            f"{BASE_URL}/api/fg/leagues",
            json={"name": "TEST_MultiAdmin FG"},
            headers=h, timeout=30,
        )
        assert r.status_code == 200, f"create fg failed: {r.status_code} {r.text}"
        STATE["fg_id"] = r.json()["id"]

        print(f"Created ids: room={STATE['room_id']} sv={STATE['sv_id']} "
              f"sal={STATE['sal_id']} fg={STATE['fg_id']}")

    # ----- TEST 3: admin2 logs in (handle password change) + is enrolled in all 4 -----
    def test_03_admin2_login_and_password_change(self):
        r = _admin_login(ADMIN2_EMAIL, ADMIN2_TEMP_PASSWORD)
        assert r.status_code == 200, f"admin2 first login failed: {r.status_code} {r.text}"
        body = r.json()
        token = body["token"]
        must_change = body.get("user", {}).get("must_change_password", False)
        assert must_change is True, (
            f"expected must_change_password=True on first login, got {body}"
        )
        # Change password
        r = requests.post(
            f"{BASE_URL}/api/auth/admin/change-password",
            json={"old_password": ADMIN2_TEMP_PASSWORD,
                  "new_password": ADMIN2_NEW_PASSWORD},
            headers=_headers(token),
            timeout=30,
        )
        assert r.status_code == 200, f"change-password failed: {r.status_code} {r.text}"
        # Re-login with new password
        r = _admin_login(ADMIN2_EMAIL, ADMIN2_NEW_PASSWORD)
        assert r.status_code == 200, f"admin2 relogin failed: {r.status_code} {r.text}"
        STATE["admin2_token"] = r.json()["token"]

    def test_04_admin2_enrolled_in_room(self):
        h = _headers(STATE["admin2_token"])
        # Room detail alone does not include memberships — use /members endpoint
        r = requests.get(f"{BASE_URL}/api/rooms/{STATE['room_id']}",
                         headers=h, timeout=30)
        assert r.status_code == 200, f"GET room as admin2: {r.status_code} {r.text}"
        detail = r.json()
        assert detail.get("is_admin") is True, (
            f"expected is_admin=True, got {detail.get('is_admin')}"
        )
        m = requests.get(f"{BASE_URL}/api/rooms/{STATE['room_id']}/members",
                         headers=h, timeout=30)
        assert m.status_code == 200, f"GET room members as admin2: {m.status_code} {m.text}"
        members = m.json()
        # members may be a list of dicts with 'user_id' or 'id'
        member_ids = {mem.get("user_id") or mem.get("id") for mem in members}
        assert STATE["admin2_id"] in member_ids, (
            f"admin2 {STATE['admin2_id']} not in room members: {members}"
        )

    def test_05_admin2_enrolled_in_sv(self):
        h = _headers(STATE["admin2_token"])
        r = requests.get(f"{BASE_URL}/api/sv/tournaments/{STATE['sv_id']}",
                         headers=h, timeout=30)
        assert r.status_code == 200, f"GET sv as admin2: {r.status_code} {r.text}"
        detail = r.json()
        assert detail.get("is_admin") is True, (
            f"expected is_admin=True, got {detail.get('is_admin')}"
        )
        p = requests.get(
            f"{BASE_URL}/api/sv/tournaments/{STATE['sv_id']}/participants",
            headers=h, timeout=30,
        )
        assert p.status_code == 200, f"GET sv participants: {p.status_code} {p.text}"
        parts = p.json()
        ids = {x.get("user_id") or x.get("id") for x in parts}
        assert STATE["admin2_id"] in ids, f"admin2 not in sv participants: {parts}"

    def test_06_admin2_enrolled_in_sal(self):
        h = _headers(STATE["admin2_token"])
        r = requests.get(f"{BASE_URL}/api/sal/tournaments/{STATE['sal_id']}",
                         headers=h, timeout=30)
        assert r.status_code == 200, f"GET sal as admin2: {r.status_code} {r.text}"
        body = r.json()
        parts = body.get("participants") or []
        ids = {p.get("user_id") for p in parts}
        assert STATE["admin2_id"] in ids, f"admin2 not in sal participants: {parts}"
        assert body.get("is_admin") is True

    def test_07_admin2_enrolled_in_fg(self):
        h = _headers(STATE["admin2_token"])
        r = requests.get(f"{BASE_URL}/api/fg/leagues/{STATE['fg_id']}",
                         headers=h, timeout=30)
        assert r.status_code == 200, f"GET fg as admin2: {r.status_code} {r.text}"
        body = r.json()
        members = body.get("members") or body.get("memberships") or []
        ids = {m.get("user_id") for m in members}
        assert STATE["admin2_id"] in ids, f"admin2 not in fg members: {members}"
        assert body.get("is_admin") is True

    # ----- TEST 4: admin2 can create invites on all 4 -----
    def test_08_admin2_can_create_room_invite(self):
        h = _headers(STATE["admin2_token"])
        r = requests.post(f"{BASE_URL}/api/rooms/{STATE['room_id']}/invites",
                          json={}, headers=h, timeout=30)
        assert r.status_code == 200, f"admin2 room invite failed: {r.status_code} {r.text}"

    def test_09_admin2_can_create_sv_invite(self):
        h = _headers(STATE["admin2_token"])
        r = requests.post(f"{BASE_URL}/api/sv/tournaments/{STATE['sv_id']}/invites",
                          json={}, headers=h, timeout=30)
        assert r.status_code == 200, f"admin2 sv invite failed: {r.status_code} {r.text}"

    def test_10_admin2_can_create_sal_invite(self):
        h = _headers(STATE["admin2_token"])
        r = requests.post(f"{BASE_URL}/api/sal/tournaments/{STATE['sal_id']}/invites",
                          json={}, headers=h, timeout=30)
        assert r.status_code == 200, f"admin2 sal invite failed: {r.status_code} {r.text}"

    def test_11_admin2_can_create_fg_invite(self):
        h = _headers(STATE["admin2_token"])
        r = requests.post(f"{BASE_URL}/api/fg/leagues/{STATE['fg_id']}/invites",
                          json={}, headers=h, timeout=30)
        assert r.status_code == 200, f"admin2 fg invite failed: {r.status_code} {r.text}"

    # ----- TEST 5: Re-promoting admin2 must return 400 'Utente già admin' -----
    def test_12_promote_existing_admin_rejected(self):
        h = _headers(STATE["admin1_token"])
        r = requests.post(
            f"{BASE_URL}/api/auth/admin/promote",
            json={"email": ADMIN2_EMAIL, "temp_password": "SomethingElse!"},
            headers=h, timeout=30,
        )
        assert r.status_code == 400, (
            f"expected 400 on re-promote, got {r.status_code} {r.text}"
        )
        detail = r.json().get("detail", "")
        assert "già admin" in detail.lower() or "gia admin" in detail.lower(), (
            f"expected 'Utente già admin' detail, got: {detail}"
        )

    # ----- TEST 6: Cleanup + cascade verification -----
    def test_13_delete_admin2_and_verify_cascade(self):
        h = _headers(STATE["admin1_token"])
        admin2_id = STATE["admin2_id"]
        r = requests.delete(
            f"{BASE_URL}/api/auth/users/{admin2_id}",
            headers=h, timeout=30,
        )
        assert r.status_code == 200, f"delete admin2 failed: {r.status_code} {r.text}"

        # Re-query the 4 objects as admin1 and confirm admin2_id is gone from
        # each membership/participant collection (via the API response).
        r = requests.get(f"{BASE_URL}/api/rooms/{STATE['room_id']}/members",
                         headers=h, timeout=30)
        assert r.status_code == 200
        members = r.json()
        assert admin2_id not in {m.get("user_id") or m.get("id") for m in members}, (
            f"admin2 still in room members after delete: {members}"
        )

        r = requests.get(
            f"{BASE_URL}/api/sv/tournaments/{STATE['sv_id']}/participants",
            headers=h, timeout=30,
        )
        assert r.status_code == 200
        parts = r.json()
        assert admin2_id not in {p.get("user_id") or p.get("id") for p in parts}, (
            f"admin2 still in sv participants after delete: {parts}"
        )

        r = requests.get(f"{BASE_URL}/api/sal/tournaments/{STATE['sal_id']}",
                         headers=h, timeout=30)
        assert r.status_code == 200
        parts = r.json().get("participants") or []
        assert admin2_id not in {p.get("user_id") for p in parts}, (
            f"admin2 still in sal participants after delete: {parts}"
        )

        r = requests.get(f"{BASE_URL}/api/fg/leagues/{STATE['fg_id']}",
                         headers=h, timeout=30)
        assert r.status_code == 200
        members = r.json().get("members") or r.json().get("memberships") or []
        assert admin2_id not in {m.get("user_id") for m in members}, (
            f"admin2 still in fg members after delete: {members}"
        )

    def test_14_cleanup_test_objects(self):
        h = _headers(STATE["admin1_token"])
        # Delete the 4 test objects
        for path in [
            f"/api/rooms/{STATE['room_id']}",
            f"/api/sv/tournaments/{STATE['sv_id']}",
            f"/api/sal/tournaments/{STATE['sal_id']}",
            f"/api/fg/leagues/{STATE['fg_id']}",
        ]:
            r = requests.delete(f"{BASE_URL}{path}", headers=h, timeout=30)
            # Accept 200 or 204; log if endpoint doesn't exist (some backends
            # may not support DELETE). We don't fail the whole run on cleanup.
            assert r.status_code in (200, 204, 404), (
                f"cleanup DELETE {path}: {r.status_code} {r.text}"
            )
