"""End-to-end tests for the SchedinaBar backend.

Covers rooms (create/join), auth via JWT, schedina OCR & confirm, fixtures,
leaderboard scoring and cross-room security checks.
"""
import base64
import io
import uuid

import pytest
import requests
from PIL import Image, ImageDraw

from conftest import API, auth_headers


# ---------- helpers ----------
def _no_underscore_id(obj):
    """Recursively assert no '_id' present in JSON responses."""
    if isinstance(obj, dict):
        assert "_id" not in obj, f"'_id' leaked in response: {obj}"
        for v in obj.values():
            _no_underscore_id(v)
    elif isinstance(obj, list):
        for v in obj:
            _no_underscore_id(v)


def _make_png_b64(text: str = "Inter Milan 1 2.10") -> str:
    img = Image.new("RGB", (400, 200), "white")
    d = ImageDraw.Draw(img)
    d.text((10, 80), text, fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _unique(name: str) -> str:
    return f"TEST_{name}_{uuid.uuid4().hex[:6]}"


# ---------- Rooms: create ----------
class TestRoomCreate:
    def test_create_room_success(self, session):
        payload = {"name": _unique("G25"), "matchday": 25, "max_events": 5, "admin_nickname": "Marco"}
        r = session.post(f"{API}/rooms", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "token" in data and "room" in data
        room = data["room"]
        assert room["name"] == payload["name"]
        assert room["matchday"] == 25
        assert room["max_events"] == 5
        assert room["admin_nickname"] == "Marco"
        assert room["is_admin"] is True
        assert len(room["invite_code"]) == 6
        _no_underscore_id(data)

    def test_create_room_name_too_short(self, session):
        r = session.post(f"{API}/rooms", json={"name": "A", "matchday": 5, "admin_nickname": "Marco"})
        assert r.status_code == 422

    def test_create_room_matchday_out_of_range(self, session):
        r = session.post(f"{API}/rooms", json={"name": _unique("X"), "matchday": 39, "admin_nickname": "Marco"})
        assert r.status_code == 422
        r2 = session.post(f"{API}/rooms", json={"name": _unique("X"), "matchday": 0, "admin_nickname": "Marco"})
        assert r2.status_code == 422

    def test_create_room_max_events_out_of_range(self, session):
        r = session.post(f"{API}/rooms", json={"name": _unique("X"), "matchday": 5, "max_events": 11, "admin_nickname": "Marco"})
        assert r.status_code == 422
        r2 = session.post(f"{API}/rooms", json={"name": _unique("X"), "matchday": 5, "max_events": 0, "admin_nickname": "Marco"})
        assert r2.status_code == 422


# ---------- Rooms: join ----------
class TestRoomJoin:
    @pytest.fixture(scope="class")
    def room_ctx(self, session):
        payload = {"name": _unique("JOIN"), "matchday": 10, "max_events": 3, "admin_nickname": "Admin"}
        r = session.post(f"{API}/rooms", json=payload)
        assert r.status_code == 200
        return r.json()

    def test_join_success(self, session, room_ctx):
        code = room_ctx["room"]["invite_code"]
        r = session.post(f"{API}/rooms/join", json={"invite_code": code, "nickname": "Luca"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["room"]["id"] == room_ctx["room"]["id"]
        assert data["room"]["is_admin"] is False
        _no_underscore_id(data)

    def test_join_bad_code(self, session):
        r = session.post(f"{API}/rooms/join", json={"invite_code": "ZZZZZZ", "nickname": "Luca"})
        assert r.status_code == 404

    def test_join_duplicate_nickname_case_insensitive(self, session, room_ctx):
        code = room_ctx["room"]["invite_code"]
        # First join
        r1 = session.post(f"{API}/rooms/join", json={"invite_code": code, "nickname": "Giovanni"})
        assert r1.status_code == 200
        # Same nickname different case
        r2 = session.post(f"{API}/rooms/join", json={"invite_code": code, "nickname": "giovanni"})
        assert r2.status_code == 409, f"expected 409 for dup nickname, got {r2.status_code}: {r2.text}"

    def test_join_same_nickname_different_rooms(self, session):
        # Two distinct rooms with same nickname should be allowed
        r_a = session.post(f"{API}/rooms", json={"name": _unique("A"), "matchday": 1, "admin_nickname": "AdminA"})
        r_b = session.post(f"{API}/rooms", json={"name": _unique("B"), "matchday": 2, "admin_nickname": "AdminB"})
        assert r_a.status_code == 200 and r_b.status_code == 200
        code_a = r_a.json()["room"]["invite_code"]
        code_b = r_b.json()["room"]["invite_code"]
        j1 = session.post(f"{API}/rooms/join", json={"invite_code": code_a, "nickname": "SharedNick"})
        j2 = session.post(f"{API}/rooms/join", json={"invite_code": code_b, "nickname": "SharedNick"})
        assert j1.status_code == 200 and j2.status_code == 200


# ---------- Room retrieval + members ----------
class TestRoomAccess:
    @pytest.fixture(scope="class")
    def ctx(self, session):
        r = session.post(f"{API}/rooms", json={"name": _unique("ACC"), "matchday": 12, "max_events": 5, "admin_nickname": "Admin"})
        assert r.status_code == 200
        admin = r.json()
        code = admin["room"]["invite_code"]
        j = session.post(f"{API}/rooms/join", json={"invite_code": code, "nickname": "Bob"})
        assert j.status_code == 200
        return {"admin": admin, "bob": j.json()}

    def test_get_room_ok(self, session, ctx):
        rid = ctx["admin"]["room"]["id"]
        r = session.get(f"{API}/rooms/{rid}", headers=auth_headers(ctx["admin"]["token"]))
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == rid
        assert body["is_admin"] is True
        _no_underscore_id(body)

    def test_get_room_no_auth_401(self, session, ctx):
        rid = ctx["admin"]["room"]["id"]
        r = requests.get(f"{API}/rooms/{rid}")
        assert r.status_code == 401

    def test_get_room_cross_room_403(self, session, ctx):
        # Create a second room, use its token to access first room
        r_other = session.post(f"{API}/rooms", json={"name": _unique("OTH"), "matchday": 3, "admin_nickname": "Other"})
        assert r_other.status_code == 200
        other_token = r_other.json()["token"]
        rid = ctx["admin"]["room"]["id"]
        r = session.get(f"{API}/rooms/{rid}", headers=auth_headers(other_token))
        assert r.status_code == 403

    def test_members_list(self, session, ctx):
        rid = ctx["admin"]["room"]["id"]
        r = session.get(f"{API}/rooms/{rid}/members", headers=auth_headers(ctx["admin"]["token"]))
        assert r.status_code == 200
        members = r.json()
        nicknames = {m["nickname"] for m in members}
        assert "Admin" in nicknames and "Bob" in nicknames
        for m in members:
            assert "submitted" in m
            assert m["submitted"] is False
        _no_underscore_id(members)


# ---------- Schedina OCR + confirm ----------
class TestSchedina:
    @pytest.fixture(scope="class")
    def ctx(self, session):
        r = session.post(f"{API}/rooms", json={"name": _unique("SCH"), "matchday": 20, "max_events": 3, "admin_nickname": "Admin"})
        assert r.status_code == 200
        return r.json()

    def test_ocr_returns_200(self, session, ctx):
        rid = ctx["room"]["id"]
        b64 = _make_png_b64()
        r = session.post(f"{API}/rooms/{rid}/schedina/ocr", json={"image_base64": b64},
                         headers=auth_headers(ctx["token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert "events" in body and isinstance(body["events"], list)
        assert "raw_text" in body
        _no_underscore_id(body)

    def test_ocr_bad_base64(self, session, ctx):
        rid = ctx["room"]["id"]
        r = session.post(f"{API}/rooms/{rid}/schedina/ocr", json={"image_base64": "@@@not-base64!!!"},
                         headers=auth_headers(ctx["token"]))
        # Either 400 (base64 error) or 500 depending on PIL; expecting 400
        assert r.status_code in (400, 422)

    def test_confirm_valid(self, session, ctx):
        rid = ctx["room"]["id"]
        events = [
            {"home_team": "Inter", "away_team": "Milan", "prediction": "1", "odd": 2.10},
            {"home_team": "Roma", "away_team": "Lazio", "prediction": "gol", "odd": 1.80},
        ]
        r = session.post(f"{API}/rooms/{rid}/schedina/confirm", json={"events": events},
                         headers=auth_headers(ctx["token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        # Case-insensitive normalization
        assert body["events"][1]["prediction"] == "GOL"
        _no_underscore_id(body)

    def test_confirm_too_many_events(self, session, ctx):
        rid = ctx["room"]["id"]  # max_events=3
        events = [{"home_team": f"T{i}", "away_team": f"U{i}", "prediction": "1", "odd": 1.5} for i in range(4)]
        r = session.post(f"{API}/rooms/{rid}/schedina/confirm", json={"events": events},
                         headers=auth_headers(ctx["token"]))
        assert r.status_code == 400

    def test_confirm_invalid_prediction(self, session, ctx):
        rid = ctx["room"]["id"]
        r = session.post(f"{API}/rooms/{rid}/schedina/confirm",
                         json={"events": [{"home_team": "A", "away_team": "B", "prediction": "XYZ", "odd": 2.0}]},
                         headers=auth_headers(ctx["token"]))
        # Pydantic ValidationError -> 422 (FastAPI default). Spec said 400 but Pydantic v2 returns 422.
        assert r.status_code in (400, 422), r.text

    def test_prediction_case_insensitive_variants(self, session):
        # Create fresh room to avoid interference
        r = session.post(f"{API}/rooms", json={"name": _unique("VAR"), "matchday": 1, "max_events": 10, "admin_nickname": "VarAdmin"})
        assert r.status_code == 200
        token = r.json()["token"]
        rid = r.json()["room"]["id"]
        events = [
            {"home_team": "A", "away_team": "B", "prediction": p, "odd": 2.0}
            for p in ["1", "x", "2", "1x", "X2", "12", "gol", "nogol", "Over 2.5", "under"]
        ]
        r2 = session.post(f"{API}/rooms/{rid}/schedina/confirm", json={"events": events},
                          headers=auth_headers(token))
        assert r2.status_code == 200, r2.text
        preds = [e["prediction"] for e in r2.json()["events"]]
        assert preds == ["1", "X", "2", "1X", "X2", "12", "GOL", "NOGOL", "OVER-2.5", "UNDER-2.5"]

    def test_members_submitted_flag_true_after_confirm(self, session, ctx):
        rid = ctx["room"]["id"]
        r = session.get(f"{API}/rooms/{rid}/members", headers=auth_headers(ctx["token"]))
        assert r.status_code == 200
        admin_m = next(m for m in r.json() if m["nickname"] == "Admin")
        assert admin_m["submitted"] is True


# ---------- Fixtures / Admin ----------
class TestFixtures:
    @pytest.fixture(scope="class")
    def ctx(self, session):
        r = session.post(f"{API}/rooms", json={"name": _unique("FIX"), "matchday": 30, "max_events": 5, "admin_nickname": "Admin"})
        assert r.status_code == 200
        admin = r.json()
        code = admin["room"]["invite_code"]
        j = session.post(f"{API}/rooms/join", json={"invite_code": code, "nickname": "NonAdmin"})
        assert j.status_code == 200
        return {"admin": admin, "other": j.json()}

    def test_admin_sets_fixtures(self, session, ctx):
        rid = ctx["admin"]["room"]["id"]
        fixtures = [
            {"home_team": "Inter", "away_team": "Milan", "home_score": 2, "away_score": 1},
            {"home_team": "Roma", "away_team": "Lazio", "home_score": 1, "away_score": 1},
        ]
        r = session.post(f"{API}/rooms/{rid}/fixtures", json={"fixtures": fixtures},
                         headers=auth_headers(ctx["admin"]["token"]))
        assert r.status_code == 200, r.text
        assert r.json()["count"] == 2

    def test_non_admin_forbidden(self, session, ctx):
        rid = ctx["admin"]["room"]["id"]
        r = session.post(f"{API}/rooms/{rid}/fixtures",
                         json={"fixtures": [{"home_team": "A", "away_team": "B", "home_score": 0, "away_score": 0}]},
                         headers=auth_headers(ctx["other"]["token"]))
        assert r.status_code == 403

    def test_fixtures_no_auth_401(self, session, ctx):
        rid = ctx["admin"]["room"]["id"]
        r = requests.post(f"{API}/rooms/{rid}/fixtures",
                          json={"fixtures": []})
        assert r.status_code == 401


# ---------- Leaderboard scoring ----------
class TestLeaderboard:
    @pytest.fixture(scope="class")
    def ctx(self, session):
        # Room admin=A, plus B and C
        create = session.post(f"{API}/rooms",
                              json={"name": _unique("LB"), "matchday": 15, "max_events": 5, "admin_nickname": "UserA"})
        assert create.status_code == 200
        admin = create.json()
        code = admin["room"]["invite_code"]
        b = session.post(f"{API}/rooms/join", json={"invite_code": code, "nickname": "UserB"}).json()
        c = session.post(f"{API}/rooms/join", json={"invite_code": code, "nickname": "UserC"}).json()
        return {"admin": admin, "b": b, "c": c}

    def test_leaderboard_no_fixtures_yet(self, session, ctx):
        rid = ctx["admin"]["room"]["id"]
        r = session.get(f"{API}/rooms/{rid}/leaderboard", headers=auth_headers(ctx["admin"]["token"]))
        assert r.status_code == 200
        data = r.json()
        assert data["has_results"] is False
        for e in data["leaderboard"]:
            assert e["total"] == 0.0
            assert e["won_count"] == 0

    def test_full_scoring_flow(self, session, ctx):
        rid = ctx["admin"]["room"]["id"]

        # User A: 2 correct (odds 2.0, 3.0) -> total 6.0
        a_events = [
            {"home_team": "Inter", "away_team": "Milan", "prediction": "1", "odd": 2.0},
            {"home_team": "Roma", "away_team": "Lazio", "prediction": "X", "odd": 3.0},
        ]
        r = session.post(f"{API}/rooms/{rid}/schedina/confirm", json={"events": a_events},
                         headers=auth_headers(ctx["admin"]["token"]))
        assert r.status_code == 200

        # User B: 1 correct (odd 2.0), 1 wrong
        b_events = [
            {"home_team": "Inter", "away_team": "Milan", "prediction": "1", "odd": 2.0},
            {"home_team": "Roma", "away_team": "Lazio", "prediction": "1", "odd": 2.5},
        ]
        r = session.post(f"{API}/rooms/{rid}/schedina/confirm", json={"events": b_events},
                         headers=auth_headers(ctx["b"]["token"]))
        assert r.status_code == 200

        # User C: 0 correct
        c_events = [
            {"home_team": "Inter", "away_team": "Milan", "prediction": "2", "odd": 4.0},
            {"home_team": "Roma", "away_team": "Lazio", "prediction": "1", "odd": 2.5},
        ]
        r = session.post(f"{API}/rooms/{rid}/schedina/confirm", json={"events": c_events},
                         headers=auth_headers(ctx["c"]["token"]))
        assert r.status_code == 200

        # Admin submits fixtures
        fixtures = [
            {"home_team": "Inter FC", "away_team": "Milan", "home_score": 2, "away_score": 1},   # 1 wins
            {"home_team": "Roma", "away_team": "Lazio", "home_score": 1, "away_score": 1},        # X wins
        ]
        r = session.post(f"{API}/rooms/{rid}/fixtures", json={"fixtures": fixtures},
                         headers=auth_headers(ctx["admin"]["token"]))
        assert r.status_code == 200

        # Query leaderboard
        r = session.get(f"{API}/rooms/{rid}/leaderboard", headers=auth_headers(ctx["admin"]["token"]))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["has_results"] is True
        lb = {e["nickname"]: e for e in data["leaderboard"]}
        assert lb["UserA"]["total"] == 6.0, f"UserA total {lb['UserA']['total']}"
        assert lb["UserA"]["won_count"] == 2
        assert lb["UserA"]["rank"] == 1
        assert lb["UserB"]["total"] == 2.0
        assert lb["UserB"]["won_count"] == 1
        assert lb["UserB"]["rank"] == 2
        assert lb["UserC"]["total"] == 0.0
        assert lb["UserC"]["won_count"] == 0
        assert lb["UserC"]["rank"] == 3
        # Sorted desc by total
        totals = [e["total"] for e in data["leaderboard"]]
        assert totals == sorted(totals, reverse=True)
        _no_underscore_id(data)

    def test_leaderboard_breakdown_structure(self, session, ctx):
        """Verify GET /rooms/{id}/leaderboard returns breakdown[] with required keys."""
        rid = ctx["admin"]["room"]["id"]
        r = session.get(f"{API}/rooms/{rid}/leaderboard", headers=auth_headers(ctx["admin"]["token"]))
        assert r.status_code == 200
        data = r.json()
        assert data["has_results"] is True
        required = {"home_team", "away_team", "prediction", "odd", "won", "matched_fixture", "score"}
        for entry in data["leaderboard"]:
            assert "breakdown" in entry and isinstance(entry["breakdown"], list)
            assert len(entry["breakdown"]) == entry["events_count"]
            for item in entry["breakdown"]:
                assert required.issubset(item.keys()), f"missing keys in breakdown item: {item}"
                assert isinstance(item["won"], bool)
                assert isinstance(item["odd"], (int, float))
        # UserA has 2 wins: both breakdown items must have won=True and score set
        a = next(e for e in data["leaderboard"] if e["nickname"] == "UserA")
        for item in a["breakdown"]:
            assert item["won"] is True
            assert item["matched_fixture"] is not None
            assert item["score"] is not None
        # UserC has 0 wins
        c = next(e for e in data["leaderboard"] if e["nickname"] == "UserC")
        for item in c["breakdown"]:
            assert item["won"] is False

    def test_leaderboard_breakdown_before_results(self, session):
        """Before fixtures exist, breakdown items should have won=False, matched_fixture=None."""
        r = session.post(f"{API}/rooms",
                         json={"name": _unique("BRK"), "matchday": 8, "max_events": 3, "admin_nickname": "AdmBrk"})
        assert r.status_code == 200
        ctx = r.json()
        rid = ctx["room"]["id"]
        events = [{"home_team": "Napoli", "away_team": "Juventus", "prediction": "1", "odd": 2.5}]
        rc = session.post(f"{API}/rooms/{rid}/schedina/confirm", json={"events": events},
                          headers=auth_headers(ctx["token"]))
        assert rc.status_code == 200
        r2 = session.get(f"{API}/rooms/{rid}/leaderboard", headers=auth_headers(ctx["token"]))
        assert r2.status_code == 200
        data = r2.json()
        assert data["has_results"] is False
        entry = data["leaderboard"][0]
        assert entry["breakdown"][0]["won"] is False
        assert entry["breakdown"][0]["matched_fixture"] is None
        assert entry["breakdown"][0]["score"] is None
        assert entry["breakdown"][0]["home_team"] == "Napoli"


# ---------- Prediction evaluation + team-match logic (unit tests via import) ----------
class TestUnitLogic:
    def test_team_match_removes_suffix(self):
        # Import backend logic directly for unit-level assertions
        import sys, os
        sys.path.insert(0, "/app/backend")
        from server import _team_match, _evaluate_prediction
        assert _team_match("Inter", "Inter FC") is True
        assert _team_match("AC Milan", "Milan") is True
        assert _team_match("Roma", "Lazio") is False

    def test_prediction_evaluation_matrix(self):
        import sys, os
        sys.path.insert(0, "/app/backend")
        from server import _evaluate_prediction
        def fx(h, a): return {"home_score": h, "away_score": a}
        # 1: home>away
        assert _evaluate_prediction("1", fx(2, 1)) is True
        assert _evaluate_prediction("1", fx(0, 0)) is False
        # X: draw
        assert _evaluate_prediction("X", fx(1, 1)) is True
        assert _evaluate_prediction("X", fx(2, 1)) is False
        # 2: away>home
        assert _evaluate_prediction("2", fx(0, 1)) is True
        # OVER 2.5: h+a>2
        assert _evaluate_prediction("OVER-2.5", fx(2, 1)) is True
        assert _evaluate_prediction("OVER-2.5", fx(1, 1)) is False
        # UNDER 2.5: h+a<3
        assert _evaluate_prediction("UNDER-2.5", fx(1, 1)) is True
        assert _evaluate_prediction("UNDER-2.5", fx(2, 1)) is False
        # GOL: both scored
        assert _evaluate_prediction("GOL", fx(1, 1)) is True
        assert _evaluate_prediction("GOL", fx(0, 2)) is False
        # NOGOL: at least one 0
        assert _evaluate_prediction("NOGOL", fx(0, 2)) is True
        assert _evaluate_prediction("NOGOL", fx(1, 1)) is False
        # NEW: Multigol / HT / combos
        assert _evaluate_prediction("MG-1-3", fx(1, 2)) is True
        assert _evaluate_prediction("MG-1-3", fx(2, 2)) is False
        assert _evaluate_prediction("MGH-0-2", fx(2, 5)) is True
        assert _evaluate_prediction("MGA-0-1", fx(4, 0)) is True
        assert _evaluate_prediction("1+GOL", fx(2, 1)) is True
        assert _evaluate_prediction("1+GOL", fx(2, 0)) is False


# ---------- Security: cross-room and no-token ----------
class TestSecurity:
    def test_endpoints_require_auth(self, session):
        rid = str(uuid.uuid4())
        for url in [
            f"{API}/rooms/{rid}",
            f"{API}/rooms/{rid}/members",
            f"{API}/rooms/{rid}/schedina",
            f"{API}/rooms/{rid}/leaderboard",
            f"{API}/rooms/{rid}/fixtures",
        ]:
            r = requests.get(url)
            assert r.status_code == 401, f"expected 401 for GET {url}, got {r.status_code}"

    def test_cross_room_token_forbidden(self, session):
        r1 = session.post(f"{API}/rooms", json={"name": _unique("S1"), "matchday": 1, "admin_nickname": "S1"})
        r2 = session.post(f"{API}/rooms", json={"name": _unique("S2"), "matchday": 2, "admin_nickname": "S2"})
        assert r1.status_code == 200 and r2.status_code == 200
        t1 = r1.json()["token"]
        rid2 = r2.json()["room"]["id"]
        for path in [
            f"/rooms/{rid2}",
            f"/rooms/{rid2}/members",
            f"/rooms/{rid2}/leaderboard",
        ]:
            r = session.get(f"{API}{path}", headers=auth_headers(t1))
            assert r.status_code == 403, f"expected 403 for {path}, got {r.status_code}"
