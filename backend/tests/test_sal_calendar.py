"""Tests for the ScoreAndLive season calendar bulk-import + auto-populate flow."""
import os, uuid, requests, pytest


API = os.environ.get("API_BASE_URL", "http://localhost:8001") + "/api"
ADMIN_EMAIL = "verone.salvatore@libero.it"
ADMIN_PASSWORD = "SchedinaBar2026!"


def _login():
    r = requests.post(f"{API}/auth/admin/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_tok():
    return _login()


SEASON = f"T{uuid.uuid4().hex[:6]}"  # <=10 chars per CalendarImportIn.season


@pytest.fixture
def sample_calendar(admin_tok):
    """Import a mini 2-matchday calendar (10 fixtures per md)."""
    teams = [
        "Alpha", "Bravo", "Charlie", "Delta", "Echo",
        "Foxtrot", "Golf", "Hotel", "India", "Juliet",
        "Kilo", "Lima", "Mike", "November", "Oscar",
        "Papa", "Quebec", "Romeo", "Sierra", "Tango",
    ]
    fixtures = []
    # Matchday 1: pair 0-1, 2-3, ..., 18-19
    for i in range(0, 20, 2):
        fixtures.append({"matchday": 1, "home_team": teams[i], "away_team": teams[i + 1]})
    # Matchday 2: rotate
    for i in range(0, 20, 2):
        fixtures.append({"matchday": 2, "home_team": teams[i + 1], "away_team": teams[(i + 3) % 20]})
    r = requests.post(f"{API}/sal/calendar/import",
                      json={"season": SEASON, "fixtures": fixtures, "replace": True},
                      headers=_h(admin_tok), timeout=15)
    r.raise_for_status()
    yield fixtures
    requests.delete(f"{API}/sal/calendar?season={SEASON}",
                    headers=_h(admin_tok), timeout=10)


def test_calendar_import_and_list(admin_tok, sample_calendar):
    r = requests.get(f"{API}/sal/calendar?season={SEASON}",
                     headers=_h(admin_tok), timeout=10)
    assert r.status_code == 200
    d = r.json()
    assert d["count"] == 20  # 2 matchdays × 10 fixtures
    md1 = [f for f in d["fixtures"] if f["matchday"] == 1]
    assert len(md1) == 10


def test_matchday_autoloads_from_calendar(admin_tok, sample_calendar):
    # Create a tournament explicitly bound to the "2025-26" season used below.
    r = requests.post(f"{API}/sal/tournaments",
                      json={"name": f"CAL_{uuid.uuid4().hex[:5]}", "initial_lives": 3,
                            "season": "2025-26"},
                      headers=_h(admin_tok), timeout=15)
    tid = r.json()["id"]
    try:
        fixtures = [
            {"matchday": 33, "home_team": f"HomeA{i}", "away_team": f"AwayA{i}"}
            for i in range(10)
        ]
        r = requests.post(f"{API}/sal/calendar/import",
                          json={"season": "2025-26", "fixtures": fixtures, "replace": False},
                          headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200

        # Create matchday 33 without explicit fixtures
        r = requests.post(f"{API}/sal/tournaments/{tid}/matchdays",
                          json={"matchday_number": 33},
                          headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200, r.text
        md = r.json()
        assert len(md["fixtures"]) == 10
        assert {f["home_team"] for f in md["fixtures"]} == {f"HomeA{i}" for i in range(10)}
    finally:
        requests.delete(f"{API}/sal/tournaments/{tid}", headers=_h(admin_tok), timeout=15)
        # Clean up our injected default-season entries
        for i in range(10):
            requests.delete(
                f"{API}/sal/calendar?season=2025-26", headers=_h(admin_tok), timeout=5
            )
            break


def test_start_matchday_prevents_earlier_matchdays(admin_tok):
    """A tournament with start_matchday=15 must reject creation of matchday 3."""
    r = requests.post(f"{API}/sal/tournaments",
                      json={"name": f"SMD_{uuid.uuid4().hex[:5]}", "initial_lives": 3,
                            "start_matchday": 15, "season": "test-x"},
                      headers=_h(admin_tok), timeout=15)
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    try:
        r = requests.post(f"{API}/sal/tournaments/{tid}/matchdays",
                          json={"matchday_number": 3},
                          headers=_h(admin_tok), timeout=15)
        assert r.status_code == 400
        assert "giornata 15" in r.json()["detail"].lower()
    finally:
        requests.delete(f"{API}/sal/tournaments/{tid}", headers=_h(admin_tok), timeout=15)


def test_matchday_autoload_fails_when_no_calendar(admin_tok):
    r = requests.post(f"{API}/sal/tournaments",
                      json={"name": f"NoCal_{uuid.uuid4().hex[:5]}", "initial_lives": 3,
                            "season": f"empty-{uuid.uuid4().hex[:4]}"},
                      headers=_h(admin_tok), timeout=15)
    tid = r.json()["id"]
    try:
        # matchday 36: nobody's calendar has it
        r = requests.post(f"{API}/sal/tournaments/{tid}/matchdays",
                          json={"matchday_number": 36},
                          headers=_h(admin_tok), timeout=15)
        assert r.status_code == 400
        assert "calendario" in r.json()["detail"].lower()
    finally:
        requests.delete(f"{API}/sal/tournaments/{tid}", headers=_h(admin_tok), timeout=15)


def test_edit_and_delete_fixture(admin_tok):
    """Admin can edit and delete individual fixtures on an open matchday."""
    r = requests.post(f"{API}/sal/tournaments",
                      json={"name": f"EDIT_{uuid.uuid4().hex[:5]}", "initial_lives": 3,
                            "season": f"edit-{uuid.uuid4().hex[:4]}"},
                      headers=_h(admin_tok), timeout=15)
    tid = r.json()["id"]
    try:
        # Create matchday with explicit fixtures
        r = requests.post(f"{API}/sal/tournaments/{tid}/matchdays",
                          json={"matchday_number": 5, "fixtures": [
                              {"home_team": "AAA", "away_team": "BBB"},
                              {"home_team": "CCC", "away_team": "DDD"},
                              {"home_team": "EEE", "away_team": "FFF"},
                          ]}, headers=_h(admin_tok), timeout=15)
        md = r.json()
        assert len(md["fixtures"]) == 3
        mid = md["id"]

        # Edit fixture 1: postpone AAA-BBB
        r = requests.patch(
            f"{API}/sal/tournaments/{tid}/matchdays/{mid}/fixtures/0",
            json={"postponed_before": True}, headers=_h(admin_tok), timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["fixtures"][0]["postponed_before"] is True

        # Delete fixture 2 (CCC-DDD, idx=1)
        r = requests.delete(
            f"{API}/sal/tournaments/{tid}/matchdays/{mid}/fixtures/1",
            headers=_h(admin_tok), timeout=10,
        )
        assert r.status_code == 200
        remaining = r.json()["fixtures"]
        assert len(remaining) == 2
        # Indices renumbered
        assert remaining[0]["home_team"] == "AAA" and remaining[0]["idx"] == 0
        assert remaining[1]["home_team"] == "EEE" and remaining[1]["idx"] == 1
    finally:
        requests.delete(f"{API}/sal/tournaments/{tid}", headers=_h(admin_tok), timeout=15)
