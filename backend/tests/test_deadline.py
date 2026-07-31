"""Test the deadline (termine per inserire schedine) feature on SchedinaBar rooms.

Covers the 9 requirements from the review request:
1. PATCH /api/rooms/{id} with future deadline_at → saved, submissions_locked=false
2. Invalid deadline_at (e.g., "abc") → 400 "Data/ora termine non valida"
3. deadline_at="" clears the deadline (GET returns null)
4. PATCH accepts partial updates without deadline_at (name/matchday/max_events/color)
5. Non-admin PATCH → 401/403
6. GET /api/rooms/{id} always returns deadline_at & submissions_locked
7. Past deadline → submissions_locked=true, OCR & confirm return 403
8. Future deadline → OCR & confirm work
9. Newly created room has deadline_at=null, submissions_locked=false, schedine work
"""
import os
import base64
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://fantasy-calcio-15.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "verone.salvatore@libero.it"
ADMIN_PW = "SchedinaBar2026!"

# Tiny valid PNG (1x1 white) base64. OCR will find nothing but still returns 200.
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
)


# ==================== Fixtures ====================
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/admin/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture()
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture()
def room(admin_h):
    """Create a fresh room per test, delete on teardown."""
    payload = {"name": f"TEST_DL_{uuid.uuid4().hex[:6]}", "matchday": 5, "max_events": 5}
    r = requests.post(f"{API}/rooms", json=payload, headers=admin_h, timeout=15)
    assert r.status_code == 200, r.text
    room = r.json()
    yield room
    try:
        requests.delete(f"{API}/rooms/{room['id']}", headers=admin_h, timeout=15)
    except Exception:
        pass


@pytest.fixture()
def player():
    """Register a player and yield {token, id, username}."""
    uname = f"TEST_dlp_{uuid.uuid4().hex[:6]}"
    reg = requests.post(f"{API}/auth/player/register",
                        json={"username": uname, "password": "testpass1"}, timeout=15)
    assert reg.status_code == 200, reg.text
    data = reg.json()
    yield {"token": data["token"], "id": data["user"]["id"], "username": uname}
    # Cleanup as admin
    try:
        adm = requests.post(f"{API}/auth/admin/login",
                            json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=15).json()
        requests.delete(f"{API}/auth/users/{data['user']['id']}",
                        headers={"Authorization": f"Bearer {adm['token']}"}, timeout=15)
    except Exception:
        pass


def _join(room, player):
    ph = {"Authorization": f"Bearer {player['token']}"}
    j = requests.post(f"{API}/rooms/join",
                      json={"invite_code": room["invite_code"]}, headers=ph, timeout=15)
    assert j.status_code == 200, j.text
    return ph


# ==================== Requirement 1: PATCH with future deadline ====================
class TestPatchFutureDeadline:
    def test_patch_future_deadline_saves_and_not_locked(self, admin_h, room):
        r = requests.patch(f"{API}/rooms/{room['id']}",
                           json={"deadline_at": "2027-01-01T18:30"},
                           headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["deadline_at"] is not None, "deadline_at missing in response"
        # Must be an ISO string with tz info (UTC)
        assert "2027-01-01" in data["deadline_at"]
        # naive input -> UTC; must round-trip as +00:00
        assert data["deadline_at"].endswith("+00:00") or data["deadline_at"].endswith("Z"), \
            f"expected UTC ISO, got {data['deadline_at']}"
        assert data["submissions_locked"] is False, "future deadline must not lock submissions"

        # Verify persisted via GET
        g = requests.get(f"{API}/rooms/{room['id']}", headers=admin_h, timeout=15)
        assert g.status_code == 200
        gd = g.json()
        assert gd["deadline_at"] == data["deadline_at"]
        assert gd["submissions_locked"] is False


# ==================== Requirement 2: invalid deadline format ====================
class TestPatchInvalidDeadline:
    def test_invalid_string_returns_400(self, admin_h, room):
        r = requests.patch(f"{API}/rooms/{room['id']}",
                           json={"deadline_at": "abc"}, headers=admin_h, timeout=15)
        assert r.status_code == 400, r.text
        assert "Data/ora termine non valida" in r.json().get("detail", "")

    def test_invalid_partial_date_returns_400(self, admin_h, room):
        r = requests.patch(f"{API}/rooms/{room['id']}",
                           json={"deadline_at": "2027-13-99T99:99"},
                           headers=admin_h, timeout=15)
        assert r.status_code == 400
        assert "Data/ora termine non valida" in r.json().get("detail", "")


# ==================== Requirement 3: empty string clears deadline ====================
class TestPatchClearDeadline:
    def test_empty_string_unsets_deadline(self, admin_h, room):
        # First set it
        r = requests.patch(f"{API}/rooms/{room['id']}",
                           json={"deadline_at": "2027-01-01T18:30"},
                           headers=admin_h, timeout=15)
        assert r.status_code == 200
        assert r.json()["deadline_at"] is not None

        # Now clear it via ""
        r2 = requests.patch(f"{API}/rooms/{room['id']}",
                            json={"deadline_at": ""}, headers=admin_h, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json().get("deadline_at") is None, \
            f"deadline_at should be null after clear, got {r2.json().get('deadline_at')}"
        assert r2.json()["submissions_locked"] is False

        # GET confirms null
        g = requests.get(f"{API}/rooms/{room['id']}", headers=admin_h, timeout=15).json()
        assert g["deadline_at"] is None
        assert g["submissions_locked"] is False


# ==================== Requirement 4: partial PATCH (other fields) ====================
class TestPatchOtherFields:
    def test_patch_name_only(self, admin_h, room):
        new_name = f"TEST_DL_RENAMED_{uuid.uuid4().hex[:4]}"
        r = requests.patch(f"{API}/rooms/{room['id']}",
                           json={"name": new_name}, headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == new_name
        assert r.json()["deadline_at"] is None  # untouched

    def test_patch_matchday_max_events_color(self, admin_h, room):
        r = requests.patch(f"{API}/rooms/{room['id']}",
                           json={"matchday": 10, "max_events": 3, "color": "#3B82F6"},
                           headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["matchday"] == 10
        assert data["max_events"] == 3
        assert data["color"] == "#3B82F6"


# ==================== Requirement 5: non-admin PATCH forbidden ====================
class TestPatchAuth:
    def test_non_admin_gets_403(self, room, player):
        ph = {"Authorization": f"Bearer {player['token']}"}
        r = requests.patch(f"{API}/rooms/{room['id']}",
                           json={"deadline_at": "2027-01-01T18:30"},
                           headers=ph, timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text}"

    def test_no_auth_gets_401_or_403(self, room):
        r = requests.patch(f"{API}/rooms/{room['id']}",
                           json={"deadline_at": "2027-01-01T18:30"}, timeout=15)
        assert r.status_code in (401, 403)


# ==================== Requirement 6: GET always returns fields ====================
class TestGetExposesFields:
    def test_fresh_room_exposes_fields(self, admin_h, room):
        g = requests.get(f"{API}/rooms/{room['id']}", headers=admin_h, timeout=15)
        assert g.status_code == 200
        d = g.json()
        assert "deadline_at" in d, "GET must always include deadline_at"
        assert "submissions_locked" in d, "GET must always include submissions_locked"
        assert d["deadline_at"] is None
        assert d["submissions_locked"] is False

    def test_room_with_deadline_exposes_fields(self, admin_h, room):
        requests.patch(f"{API}/rooms/{room['id']}",
                       json={"deadline_at": "2027-06-15T20:00"},
                       headers=admin_h, timeout=15)
        g = requests.get(f"{API}/rooms/{room['id']}", headers=admin_h, timeout=15).json()
        assert "deadline_at" in g and g["deadline_at"] is not None
        assert "submissions_locked" in g and g["submissions_locked"] is False


# ==================== Requirement 7: past deadline locks submissions ====================
class TestPastDeadlineLocks:
    def test_past_deadline_locks_and_ocr_confirm_return_403(self, admin_h, room, player):
        # Player joins first (deadline still open)
        ph = _join(room, player)

        # Now admin sets deadline in the past
        r = requests.patch(f"{API}/rooms/{room['id']}",
                           json={"deadline_at": "2020-01-01T00:00"},
                           headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["submissions_locked"] is True

        # GET also shows locked
        g = requests.get(f"{API}/rooms/{room['id']}", headers=admin_h, timeout=15).json()
        assert g["submissions_locked"] is True

        # OCR must return 403 with the exact detail
        o = requests.post(f"{API}/rooms/{room['id']}/schedina/ocr",
                          json={"image_base64": TINY_PNG_B64}, headers=ph, timeout=30)
        assert o.status_code == 403, f"OCR should be locked, got {o.status_code}: {o.text}"
        assert o.json().get("detail") == "Termine per l'inserimento delle schedine scaduto"

        # confirm must also return 403 with same detail
        c = requests.post(f"{API}/rooms/{room['id']}/schedina/confirm",
                          json={"events": [{"home_team": "A", "away_team": "B",
                                            "prediction": "1", "odd": 1.5}]},
                          headers=ph, timeout=15)
        assert c.status_code == 403, f"confirm should be locked, got {c.status_code}: {c.text}"
        assert c.json().get("detail") == "Termine per l'inserimento delle schedine scaduto"


# ==================== Requirement 8: future deadline allows submissions ====================
class TestFutureDeadlineAllows:
    def test_future_deadline_ocr_and_confirm_work(self, admin_h, room, player):
        ph = _join(room, player)
        # Set future deadline
        requests.patch(f"{API}/rooms/{room['id']}",
                       json={"deadline_at": "2027-01-01T18:30"},
                       headers=admin_h, timeout=15)

        # OCR should succeed (even with a blank image → empty events)
        o = requests.post(f"{API}/rooms/{room['id']}/schedina/ocr",
                          json={"image_base64": TINY_PNG_B64}, headers=ph, timeout=30)
        assert o.status_code == 200, f"OCR should work, got {o.status_code}: {o.text}"
        body = o.json()
        assert "events" in body and "raw_text" in body

        # confirm with a single valid event
        c = requests.post(f"{API}/rooms/{room['id']}/schedina/confirm",
                          json={"events": [{"home_team": "Inter", "away_team": "Milan",
                                            "prediction": "1", "odd": 2.10}]},
                          headers=ph, timeout=15)
        assert c.status_code == 200, f"confirm should work, got {c.status_code}: {c.text}"
        assert c.json()["ok"] is True


# ==================== Requirement 9: fresh room without deadline works ====================
class TestFreshRoomNoDeadline:
    def test_new_room_has_null_deadline_and_schedine_work(self, admin_h, room, player):
        # room fixture already creates a new room
        assert room["deadline_at"] is None
        assert room["submissions_locked"] is False

        ph = _join(room, player)
        # OCR works
        o = requests.post(f"{API}/rooms/{room['id']}/schedina/ocr",
                          json={"image_base64": TINY_PNG_B64}, headers=ph, timeout=30)
        assert o.status_code == 200, o.text

        # confirm works
        c = requests.post(f"{API}/rooms/{room['id']}/schedina/confirm",
                          json={"events": [{"home_team": "Roma", "away_team": "Lazio",
                                            "prediction": "X", "odd": 3.20}]},
                          headers=ph, timeout=15)
        assert c.status_code == 200, c.text
        assert c.json()["ok"] is True


# ==================== Extra: preserve deadline_at when patching other fields ====================
class TestDeadlinePreservation:
    def test_patching_name_preserves_deadline(self, admin_h, room):
        # Set deadline
        r1 = requests.patch(f"{API}/rooms/{room['id']}",
                            json={"deadline_at": "2027-05-05T12:00"},
                            headers=admin_h, timeout=15)
        assert r1.status_code == 200
        original_deadline = r1.json()["deadline_at"]
        assert original_deadline is not None

        # Patch only name
        r2 = requests.patch(f"{API}/rooms/{room['id']}",
                            json={"name": f"TEST_DL_KEEP_{uuid.uuid4().hex[:4]}"},
                            headers=admin_h, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["deadline_at"] == original_deadline, \
            "PATCH must not overwrite deadline_at when field is not sent (exclude_unset)"
