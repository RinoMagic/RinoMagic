"""End-to-end tests for the one-shot invite system.

Covers the review request:
1.  POST /api/rooms → invites_available=1, invites_total=1
2.  GET /api/rooms/{id}/invites (admin only) returns the auto-generated first invite
3.  POST /api/rooms/{id}/invites → creates single-use invite with used_by_user_id=null, revoked_at=null
4.  GET /api/rooms/by-code/{code} public preview only when code exists AND not used AND not revoked
5.  POST /api/rooms/join marks invite as used_by; second user retrying same code → HTTP 410
    with detail "Codice invito già utilizzato"
6.  Idempotence: same user retrying → 200 (not 410)
7.  DELETE /api/rooms/{id}/invites/{invite_id} revokes unused invite; used invite → 400
8.  Preview of a revoked invite → 410 detail contains "revocat"
9.  Race-condition: two concurrent joins → only one succeeds
10. GET /api/rooms/{id} includes invites_available and invites_total
"""
import os
import uuid
import threading
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://fantasy-calcio-15.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "verone.salvatore@libero.it"
ADMIN_PW = "SchedinaBar2026!"

TIMEOUT = 20


# ---------- helpers ----------
def _admin_login() -> str:
    r = requests.post(f"{API}/auth/admin/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=TIMEOUT)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _register_player() -> dict:
    uname = f"TEST_osi_{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/auth/player/register",
                      json={"username": uname, "password": "testpass1"}, timeout=TIMEOUT)
    assert r.status_code == 200, f"player register failed: {r.status_code} {r.text}"
    body = r.json()
    return {"token": body["token"], "id": body["user"]["id"], "username": uname}


def _delete_user(admin_token: str, user_id: str) -> None:
    try:
        requests.delete(f"{API}/auth/users/{user_id}",
                        headers={"Authorization": f"Bearer {admin_token}"}, timeout=TIMEOUT)
    except Exception:
        pass


def _delete_room(admin_token: str, room_id: str) -> None:
    try:
        requests.delete(f"{API}/rooms/{room_id}",
                        headers={"Authorization": f"Bearer {admin_token}"}, timeout=TIMEOUT)
    except Exception:
        pass


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_token() -> str:
    return _admin_login()


@pytest.fixture(scope="module")
def admin_h(admin_token) -> dict:
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
def fresh_room(admin_h, admin_token):
    """A brand new room, deleted after the test."""
    payload = {"name": f"TEST_OSI_{uuid.uuid4().hex[:6]}", "matchday": 7, "max_events": 5}
    r = requests.post(f"{API}/rooms", json=payload, headers=admin_h, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    room = r.json()
    yield room
    _delete_room(admin_token, room["id"])


# ---------------- 1) create_room returns invites_available/invites_total ----------------
class TestCreateRoomReturnsInviteStats:
    def test_create_room_returns_invites_available_and_total_equal_one(self, admin_h, admin_token):
        payload = {"name": f"TEST_OSI_{uuid.uuid4().hex[:6]}", "matchday": 3, "max_events": 5}
        r = requests.post(f"{API}/rooms", json=payload, headers=admin_h, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        room = r.json()
        try:
            assert "invites_total" in room, "invites_total missing on POST /api/rooms response"
            assert "invites_available" in room, "invites_available missing on POST /api/rooms response"
            assert room["invites_total"] == 1, f"expected 1 got {room['invites_total']}"
            assert room["invites_available"] == 1, f"expected 1 got {room['invites_available']}"
            # sanity: invite_code is populated
            assert isinstance(room.get("invite_code"), str) and len(room["invite_code"]) >= 4
        finally:
            _delete_room(admin_token, room["id"])


# ---------------- 2) GET /api/rooms/{id}/invites returns the first invite ----------------
class TestListInvites:
    def test_list_invites_returns_auto_generated_first_invite(self, admin_h, fresh_room):
        r = requests.get(f"{API}/rooms/{fresh_room['id']}/invites",
                         headers=admin_h, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        invites = r.json()
        assert isinstance(invites, list) and len(invites) == 1, f"expected 1 invite, got {invites}"
        first = invites[0]
        assert first["code"] == fresh_room["invite_code"]
        assert first["used_by_user_id"] is None
        assert first["revoked_at"] is None
        assert "id" in first
        assert "created_at" in first

    def test_list_invites_requires_admin(self, fresh_room, admin_token):
        player = _register_player()
        try:
            ph = {"Authorization": f"Bearer {player['token']}"}
            r = requests.get(f"{API}/rooms/{fresh_room['id']}/invites",
                             headers=ph, timeout=TIMEOUT)
            assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code} {r.text}"
        finally:
            _delete_user(admin_token, player["id"])

    def test_list_invites_unknown_room_returns_404(self, admin_h):
        r = requests.get(f"{API}/rooms/does-not-exist/invites",
                         headers=admin_h, timeout=TIMEOUT)
        assert r.status_code == 404


# ---------------- 3) POST /api/rooms/{id}/invites generates a new code ----------------
class TestCreateInvite:
    def test_create_invite_returns_fresh_single_use_code(self, admin_h, fresh_room):
        r = requests.post(f"{API}/rooms/{fresh_room['id']}/invites",
                          headers=admin_h, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        inv = r.json()
        assert "code" in inv and isinstance(inv["code"], str) and len(inv["code"]) >= 4
        assert inv["used_by_user_id"] is None
        assert inv["revoked_at"] is None
        assert inv["code"] != fresh_room["invite_code"], "new code must differ from initial one"

        # And the list must now contain 2 invites
        lst = requests.get(f"{API}/rooms/{fresh_room['id']}/invites",
                           headers=admin_h, timeout=TIMEOUT).json()
        assert len(lst) == 2, f"expected 2 invites, got {len(lst)}"
        codes = {i["code"] for i in lst}
        assert fresh_room["invite_code"] in codes and inv["code"] in codes

    def test_create_invite_requires_admin(self, fresh_room, admin_token):
        player = _register_player()
        try:
            ph = {"Authorization": f"Bearer {player['token']}"}
            r = requests.post(f"{API}/rooms/{fresh_room['id']}/invites",
                              headers=ph, timeout=TIMEOUT)
            assert r.status_code in (401, 403)
        finally:
            _delete_user(admin_token, player["id"])


# ---------------- 4) public preview only for valid+unused+not-revoked ----------------
class TestPreviewByCode:
    def test_preview_valid_code_no_auth(self, fresh_room):
        r = requests.get(f"{API}/rooms/by-code/{fresh_room['invite_code']}", timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["id"] == fresh_room["id"]
        assert data["invite_code"] == fresh_room["invite_code"]
        # sanity: no sensitive fields
        assert "admin_user_id" not in data

    def test_preview_invalid_code_returns_404(self):
        r = requests.get(f"{API}/rooms/by-code/DOES_NOT_EXIST", timeout=TIMEOUT)
        assert r.status_code == 404

    def test_preview_used_code_returns_410_with_used_detail(self, admin_h, admin_token, fresh_room):
        player = _register_player()
        try:
            # consume the invite
            ph = {"Authorization": f"Bearer {player['token']}"}
            join = requests.post(f"{API}/rooms/join",
                                 json={"invite_code": fresh_room["invite_code"]},
                                 headers=ph, timeout=TIMEOUT)
            assert join.status_code == 200, join.text
            # preview now must be 410 with "già utilizzato" detail
            r = requests.get(f"{API}/rooms/by-code/{fresh_room['invite_code']}", timeout=TIMEOUT)
            assert r.status_code == 410, f"expected 410 got {r.status_code} {r.text}"
            detail = (r.json().get("detail") or "").lower()
            assert "utilizzat" in detail, f"detail should mention already-used, got: {detail}"
        finally:
            _delete_user(admin_token, player["id"])


# ---------------- 5) join marks invite as used; second user → 410 ----------------
class TestJoinConsumesInviteOneShot:
    def test_first_user_joins_second_user_gets_410(self, admin_h, admin_token, fresh_room):
        p1 = _register_player()
        p2 = _register_player()
        try:
            # p1 joins → success, invite becomes used
            r1 = requests.post(f"{API}/rooms/join",
                               json={"invite_code": fresh_room["invite_code"]},
                               headers={"Authorization": f"Bearer {p1['token']}"},
                               timeout=TIMEOUT)
            assert r1.status_code == 200, r1.text
            assert r1.json()["id"] == fresh_room["id"]

            # Verify the invite doc reflects used_by_user_id = p1
            lst = requests.get(f"{API}/rooms/{fresh_room['id']}/invites",
                               headers=admin_h, timeout=TIMEOUT).json()
            initial = next((i for i in lst if i["code"] == fresh_room["invite_code"]), None)
            assert initial is not None
            assert initial["used_by_user_id"] == p1["id"], f"invite not marked used_by p1: {initial}"
            assert initial["used_at"] is not None

            # p2 tries same code → 410 with expected detail
            r2 = requests.post(f"{API}/rooms/join",
                               json={"invite_code": fresh_room["invite_code"]},
                               headers={"Authorization": f"Bearer {p2['token']}"},
                               timeout=TIMEOUT)
            assert r2.status_code == 410, f"expected 410 got {r2.status_code} {r2.text}"
            detail = r2.json().get("detail", "")
            assert detail == "Codice invito già utilizzato", f"unexpected detail: {detail}"
        finally:
            _delete_user(admin_token, p1["id"])
            _delete_user(admin_token, p2["id"])

    def test_invalid_code_join_returns_404(self):
        p = _register_player()
        try:
            r = requests.post(f"{API}/rooms/join",
                              json={"invite_code": "NOPE12345"},
                              headers={"Authorization": f"Bearer {p['token']}"},
                              timeout=TIMEOUT)
            assert r.status_code == 404
        finally:
            _delete_user(_admin_login(), p["id"])


# ---------------- 6) Idempotence: same user retry → 200 ----------------
class TestJoinIdempotenceSameUser:
    def test_same_user_retry_returns_200(self, admin_h, admin_token, fresh_room):
        p1 = _register_player()
        try:
            hdr = {"Authorization": f"Bearer {p1['token']}"}
            r1 = requests.post(f"{API}/rooms/join",
                               json={"invite_code": fresh_room["invite_code"]},
                               headers=hdr, timeout=TIMEOUT)
            assert r1.status_code == 200, r1.text

            # Retry → must be 200 (not 410) because same user
            r2 = requests.post(f"{API}/rooms/join",
                               json={"invite_code": fresh_room["invite_code"]},
                               headers=hdr, timeout=TIMEOUT)
            assert r2.status_code == 200, f"idempotence broken: got {r2.status_code} {r2.text}"
            assert r2.json()["id"] == fresh_room["id"]
        finally:
            _delete_user(admin_token, p1["id"])


# ---------------- 7) DELETE revoke: unused OK, used → 400 ----------------
class TestRevokeInvite:
    def test_revoke_unused_invite_ok(self, admin_h, fresh_room):
        # Create a fresh extra invite so we don't disturb the initial one
        created = requests.post(f"{API}/rooms/{fresh_room['id']}/invites",
                                headers=admin_h, timeout=TIMEOUT).json()
        assert created["revoked_at"] is None

        r = requests.delete(f"{API}/rooms/{fresh_room['id']}/invites/{created['id']}",
                            headers=admin_h, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["id"] == created["id"]
        assert body["revoked_at"] is not None

        # Idempotent revoke: calling again returns 200 with same revoked_at (or another revoked_at)
        r2 = requests.delete(f"{API}/rooms/{fresh_room['id']}/invites/{created['id']}",
                             headers=admin_h, timeout=TIMEOUT)
        assert r2.status_code == 200, r2.text
        assert r2.json()["revoked_at"] is not None

    def test_revoke_used_invite_returns_400(self, admin_h, admin_token, fresh_room):
        p = _register_player()
        try:
            # consume initial invite
            join = requests.post(f"{API}/rooms/join",
                                 json={"invite_code": fresh_room["invite_code"]},
                                 headers={"Authorization": f"Bearer {p['token']}"},
                                 timeout=TIMEOUT)
            assert join.status_code == 200, join.text

            # find its id
            lst = requests.get(f"{API}/rooms/{fresh_room['id']}/invites",
                               headers=admin_h, timeout=TIMEOUT).json()
            used = next(i for i in lst if i["code"] == fresh_room["invite_code"])

            r = requests.delete(f"{API}/rooms/{fresh_room['id']}/invites/{used['id']}",
                                headers=admin_h, timeout=TIMEOUT)
            assert r.status_code == 400, f"expected 400 got {r.status_code} {r.text}"
        finally:
            _delete_user(admin_token, p["id"])

    def test_revoke_requires_admin(self, admin_h, admin_token, fresh_room):
        created = requests.post(f"{API}/rooms/{fresh_room['id']}/invites",
                                headers=admin_h, timeout=TIMEOUT).json()
        p = _register_player()
        try:
            r = requests.delete(f"{API}/rooms/{fresh_room['id']}/invites/{created['id']}",
                                headers={"Authorization": f"Bearer {p['token']}"},
                                timeout=TIMEOUT)
            assert r.status_code in (401, 403)
        finally:
            _delete_user(admin_token, p["id"])


# ---------------- 8) Preview revoked → 410 with "revocat" ----------------
class TestPreviewRevoked:
    def test_preview_of_revoked_returns_410_revocat(self, admin_h, fresh_room):
        # create a spare invite and revoke it
        created = requests.post(f"{API}/rooms/{fresh_room['id']}/invites",
                                headers=admin_h, timeout=TIMEOUT).json()
        rev = requests.delete(f"{API}/rooms/{fresh_room['id']}/invites/{created['id']}",
                              headers=admin_h, timeout=TIMEOUT)
        assert rev.status_code == 200

        r = requests.get(f"{API}/rooms/by-code/{created['code']}", timeout=TIMEOUT)
        assert r.status_code == 410, f"expected 410 got {r.status_code} {r.text}"
        detail = (r.json().get("detail") or "").lower()
        assert "revocat" in detail, f"detail should mention 'revocat', got: {detail}"


# ---------------- 9) Race condition: two concurrent joins → only one succeeds ----------------
class TestRaceCondition:
    def test_concurrent_joins_only_one_wins(self, admin_h, admin_token, fresh_room):
        p1 = _register_player()
        p2 = _register_player()
        results = {}
        try:
            def _join(label: str, token: str):
                try:
                    r = requests.post(f"{API}/rooms/join",
                                      json={"invite_code": fresh_room["invite_code"]},
                                      headers={"Authorization": f"Bearer {token}"},
                                      timeout=TIMEOUT)
                    results[label] = (r.status_code, r.text)
                except Exception as e:
                    results[label] = (0, str(e))

            t1 = threading.Thread(target=_join, args=("p1", p1["token"]))
            t2 = threading.Thread(target=_join, args=("p2", p2["token"]))
            t1.start(); t2.start()
            t1.join(); t2.join()

            statuses = sorted(v[0] for v in results.values())
            assert 200 in statuses, f"neither user succeeded: {results}"
            # exactly one 200 and one 410
            n_ok = sum(1 for s in statuses if s == 200)
            n_gone = sum(1 for s in statuses if s == 410)
            assert n_ok == 1 and n_gone == 1, f"race broken (n_ok={n_ok}, n_gone={n_gone}): {results}"

            # confirm invite is definitely marked used, and by exactly one of the two
            lst = requests.get(f"{API}/rooms/{fresh_room['id']}/invites",
                               headers=admin_h, timeout=TIMEOUT).json()
            initial = next(i for i in lst if i["code"] == fresh_room["invite_code"])
            assert initial["used_by_user_id"] in (p1["id"], p2["id"])
        finally:
            _delete_user(admin_token, p1["id"])
            _delete_user(admin_token, p2["id"])


# ---------------- 10) GET /api/rooms/{id} exposes invites_available/invites_total ----------------
class TestGetRoomInviteStats:
    def test_get_room_includes_invite_stats(self, admin_h, fresh_room):
        r = requests.get(f"{API}/rooms/{fresh_room['id']}", headers=admin_h, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "invites_available" in body
        assert "invites_total" in body
        assert body["invites_available"] == 1
        assert body["invites_total"] == 1

    def test_stats_update_after_create_use_and_revoke(self, admin_h, admin_token, fresh_room):
        # Start: 1 available, 1 total
        # Add a second invite → 2 available, 2 total
        created = requests.post(f"{API}/rooms/{fresh_room['id']}/invites",
                                headers=admin_h, timeout=TIMEOUT).json()
        b = requests.get(f"{API}/rooms/{fresh_room['id']}", headers=admin_h, timeout=TIMEOUT).json()
        assert b["invites_total"] == 2 and b["invites_available"] == 2, b

        # Use the initial one → 2 total, 1 available
        p = _register_player()
        try:
            join = requests.post(f"{API}/rooms/join",
                                 json={"invite_code": fresh_room["invite_code"]},
                                 headers={"Authorization": f"Bearer {p['token']}"},
                                 timeout=TIMEOUT)
            assert join.status_code == 200, join.text
            b = requests.get(f"{API}/rooms/{fresh_room['id']}", headers=admin_h, timeout=TIMEOUT).json()
            assert b["invites_total"] == 2, b
            assert b["invites_available"] == 1, b

            # Revoke the spare one → total decreases (revoked_at != None excluded), available stays 0
            rev = requests.delete(f"{API}/rooms/{fresh_room['id']}/invites/{created['id']}",
                                  headers=admin_h, timeout=TIMEOUT)
            assert rev.status_code == 200
            b = requests.get(f"{API}/rooms/{fresh_room['id']}", headers=admin_h, timeout=TIMEOUT).json()
            # invites_total counts non-revoked ones per server.py:700-701
            assert b["invites_total"] == 1, b
            assert b["invites_available"] == 0, b
        finally:
            _delete_user(admin_token, p["id"])
