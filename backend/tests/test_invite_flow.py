"""Test invite-code flow and reset-player-password fix.

Covers the review request:
- GET /api/rooms/by-code/{invite_code} public preview (no auth)
- Invalid invite code returns 404
- Full flow: admin creates room -> preview -> player register -> join
- POST /api/auth/users/reset-password (already tested indirectly by admin UI fix)
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://fantasy-calcio-15.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "verone.salvatore@libero.it"
ADMIN_PW = "SchedinaBar2026!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def room(admin_token):
    """Create a room owned by admin, return its dict. Deleted at teardown."""
    h = {"Authorization": f"Bearer {admin_token}"}
    payload = {"name": f"TEST_INVITE_{uuid.uuid4().hex[:6]}", "matchday": 5, "max_events": 5}
    r = requests.post(f"{API}/rooms", json=payload, headers=h, timeout=15)
    assert r.status_code == 200, r.text
    room = r.json()
    yield room
    # Teardown
    try:
        requests.delete(f"{API}/rooms/{room['id']}", headers=h, timeout=15)
    except Exception:
        pass


class TestInvitePreview:
    def test_preview_public_no_auth(self, room):
        """GET /api/rooms/by-code/{invite_code} returns 200 WITHOUT auth."""
        r = requests.get(f"{API}/rooms/by-code/{room['invite_code']}", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["id"] == room["id"]
        assert data["name"] == room["name"]
        assert data["invite_code"] == room["invite_code"]
        assert data["matchday"] == room["matchday"]
        assert "max_events" in data
        assert "color" in data
        assert "status" in data

    def test_preview_lowercase_code_still_works(self, room):
        """API upper-cases the code, so lowercase input should still resolve."""
        r = requests.get(f"{API}/rooms/by-code/{room['invite_code'].lower()}", timeout=15)
        assert r.status_code == 200
        assert r.json()["invite_code"] == room["invite_code"]

    def test_preview_invalid_code_returns_404(self):
        r = requests.get(f"{API}/rooms/by-code/INVALID99", timeout=15)
        assert r.status_code == 404
        body = r.json()
        assert "Codice invito non valido" in body.get("detail", "")

    def test_preview_does_not_leak_sensitive_fields(self, room):
        """Public preview must not expose admin_user_id, members_count, etc."""
        r = requests.get(f"{API}/rooms/by-code/{room['invite_code']}", timeout=15)
        assert r.status_code == 200
        data = r.json()
        # These fields must NOT be present in the public preview
        assert "admin_user_id" not in data, "public preview leaks admin_user_id"


class TestInviteFullFlow:
    def test_admin_creates_room_player_registers_and_joins(self, admin_token, room):
        # 1) preview (as unauthenticated visitor)
        preview = requests.get(f"{API}/rooms/by-code/{room['invite_code']}", timeout=15).json()
        assert preview["invite_code"] == room["invite_code"]

        # 2) player registers
        uname = f"TEST_inv_{uuid.uuid4().hex[:6]}"
        reg = requests.post(f"{API}/auth/player/register", json={"username": uname, "password": "testpass1"}, timeout=15)
        assert reg.status_code == 200, reg.text
        player_token = reg.json()["token"]
        player_id = reg.json()["user"]["id"]

        # 3) player joins via /api/rooms/join
        ph = {"Authorization": f"Bearer {player_token}"}
        join = requests.post(f"{API}/rooms/join", json={"invite_code": room["invite_code"]}, headers=ph, timeout=15)
        assert join.status_code == 200, join.text
        assert join.json()["id"] == room["id"]

        # 4) verify membership persisted: player can GET /rooms
        my_rooms = requests.get(f"{API}/rooms", headers=ph, timeout=15).json()
        assert any(r["id"] == room["id"] for r in my_rooms), "room not in player's list after join"

        # Cleanup: delete player as admin
        ah = {"Authorization": f"Bearer {admin_token}"}
        requests.delete(f"{API}/auth/users/{player_id}", headers=ah, timeout=15)


class TestResetPlayerPassword:
    """Admin reset-player-password endpoint (the button that was broken on web)."""

    def test_admin_can_reset_player_password_and_player_can_login(self, admin_token):
        # Create fresh player
        uname = f"TEST_rpw_{uuid.uuid4().hex[:6]}"
        reg = requests.post(f"{API}/auth/player/register", json={"username": uname, "password": "oldpass1"}, timeout=15)
        assert reg.status_code == 200, reg.text
        player_id = reg.json()["user"]["id"]

        # Admin resets password
        ah = {"Authorization": f"Bearer {admin_token}"}
        new_pw = "newTemp1A"
        r = requests.post(f"{API}/auth/users/reset-password",
                          json={"user_id": player_id, "new_password": new_pw},
                          headers=ah, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Old password must NOT work
        old_login = requests.post(f"{API}/auth/player/login", json={"username": uname, "password": "oldpass1"}, timeout=15)
        assert old_login.status_code == 401

        # New password must work
        new_login = requests.post(f"{API}/auth/player/login", json={"username": uname, "password": new_pw}, timeout=15)
        assert new_login.status_code == 200, new_login.text
        assert new_login.json()["user"]["id"] == player_id

        # Cleanup
        requests.delete(f"{API}/auth/users/{player_id}", headers=ah, timeout=15)

    def test_reset_password_unknown_user_returns_404(self, admin_token):
        ah = {"Authorization": f"Bearer {admin_token}"}
        r = requests.post(f"{API}/auth/users/reset-password",
                          json={"user_id": "00000000-0000-0000-0000-000000000000",
                                "new_password": "whatever1"},
                          headers=ah, timeout=15)
        assert r.status_code == 404

    def test_reset_password_requires_admin(self):
        # Register a plain player and try to hit the endpoint
        uname = f"TEST_rpw_neg_{uuid.uuid4().hex[:6]}"
        reg = requests.post(f"{API}/auth/player/register", json={"username": uname, "password": "abcdef1"}, timeout=15)
        assert reg.status_code == 200
        ptok = reg.json()["token"]
        pid = reg.json()["user"]["id"]
        ph = {"Authorization": f"Bearer {ptok}"}
        r = requests.post(f"{API}/auth/users/reset-password",
                         json={"user_id": pid, "new_password": "xyzzy123"},
                         headers=ph, timeout=15)
        assert r.status_code == 403

        # Cleanup with admin token via a fresh login
        alogin = requests.post(f"{API}/auth/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=15).json()
        requests.delete(f"{API}/auth/users/{pid}",
                        headers={"Authorization": f"Bearer {alogin['token']}"}, timeout=15)


class TestDeleteRoom:
    def test_delete_room_endpoint_works(self, admin_token):
        h = {"Authorization": f"Bearer {admin_token}"}
        payload = {"name": f"TEST_DEL_{uuid.uuid4().hex[:6]}", "matchday": 3, "max_events": 3}
        r = requests.post(f"{API}/rooms", json=payload, headers=h, timeout=15)
        assert r.status_code == 200
        room_id = r.json()["id"]
        invite = r.json()["invite_code"]

        d = requests.delete(f"{API}/rooms/{room_id}", headers=h, timeout=15)
        assert d.status_code == 200, d.text
        # Preview should now 404
        p = requests.get(f"{API}/rooms/by-code/{invite}", timeout=15)
        assert p.status_code == 404
