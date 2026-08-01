"""End-to-end test with REAL players from the matchday 38 Voti PDF.

This test validates the full FantaGiornata pipeline against known-good numbers
from the real Voti fixture. All players are inserted with a ``first_name`` tag
(``RVOTI``) so we can identify and query them without conflicts.

Reference facts from matchday 38 (imported voti):
- Bonazzoli (Cremonese, A):  voto 7,   Rf=1        →  7 + 3 = 10.0
- Da Cunha  (Como, C):       voto 8,   Gf=1, Rf=1  →  8 + 3 + 3 = 14.0
- Douvikas  (Como, A):       voto 7,   Gf=1        →  7 + 3 = 10.0
- Skorupski (Bologna, P):    voto 6,   Gs=3        →  6 - 3 = 3.0
- Ahanor    (Atalanta, D):   voto 5.5, Amm=1       →  5.5 - 0.5 = 5.0

Padding players (used to fill the 11 starters + 8 bench slots) use fake team
names so they never match a real Voti fact → their fantavoto is None.
"""
from __future__ import annotations

import os, pathlib, uuid, requests, pytest


API = os.environ.get("API_BASE_URL", "http://localhost:8001") + "/api"
ADMIN_EMAIL = "verone.salvatore@libero.it"
ADMIN_PASSWORD = "SchedinaBar2026!"
FIXTURE_PDF = pathlib.Path(__file__).parent / "fixtures" / "voti_giornata_38.pdf"

# Isolated matchday number to avoid clashes with other test modules.
TEST_MATCHDAY = 25

# The 5 real players whose fantavoto we predict exactly.
REAL_PLAYERS = [
    ("Bonazzoli", "Cremonese", "A", 10.0),
    ("Da Cunha",  "Como",      "C", 14.0),
    ("Douvikas",  "Como",      "A", 10.0),
    ("Skorupski", "Bologna",   "P",  3.0),
    ("Ahanor",    "Atalanta",  "D",  5.0),
]

# Padding players — fake teams so they never match a Voti fact.
PADDING = [
    # remaining starters after the 5 reals: need 1P not filled + others
    # Already: 1P (Skorupski), 1D (Ahanor), 1C (Da Cunha), 2A (Bonazzoli+Douvikas)
    # Need: +3 D, +2 C, +1 A = 6 more starters (total 11)
    ("PadD1", "FAKETEAM1", "D"),
    ("PadD2", "FAKETEAM1", "D"),
    ("PadD3", "FAKETEAM1", "D"),
    ("PadC1", "FAKETEAM1", "C"),
    ("PadC2", "FAKETEAM1", "C"),
    ("PadA1", "FAKETEAM1", "A"),
    # Bench: 2P + 2D + 2C + 2A
    ("PadBP1", "FAKETEAM2", "P"),
    ("PadBP2", "FAKETEAM2", "P"),
    ("PadBD1", "FAKETEAM2", "D"),
    ("PadBD2", "FAKETEAM2", "D"),
    ("PadBC1", "FAKETEAM2", "C"),
    ("PadBC2", "FAKETEAM2", "C"),
    ("PadBA1", "FAKETEAM2", "A"),
    ("PadBA2", "FAKETEAM2", "A"),
]


def _login():
    r = requests.post(f"{API}/auth/admin/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _register_player(username: str) -> str:
    r = requests.post(f"{API}/auth/player/register",
                      json={"username": username, "password": "pass123"}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_tok():
    return _login()


@pytest.fixture(scope="module", autouse=True)
def voti_imported(admin_tok):
    with FIXTURE_PDF.open("rb") as f:
        requests.post(
            f"{API}/admin/voti/upload-pdf",
            params={"dry_run": "false", "replace": "true",
                    "matchday_override": TEST_MATCHDAY},
            files={"file": ("voti.pdf", f, "application/pdf")},
            headers=_h(admin_tok), timeout=60,
        ).raise_for_status()
    yield
    requests.delete(f"{API}/admin/voti/{TEST_MATCHDAY}", headers=_h(admin_tok), timeout=10)


@pytest.fixture(scope="module")
def real_roster(admin_tok):
    """Insert real-named + padding players. Query them back via q=RVOTI."""
    payload = []
    for last, team, role, _fv in REAL_PLAYERS:
        payload.append({"first_name": "RVOTI", "last_name": last, "team": team, "role": role})
    for last, team, role in PADDING:
        payload.append({"first_name": "RVOTI", "last_name": last, "team": team, "role": role})

    requests.post(f"{API}/sal/players/import",
                  json={"replace_all": False, "players": payload},
                  headers=_h(admin_tok), timeout=30).raise_for_status()

    r = requests.get(f"{API}/sal/players?q=RVOTI&limit=200",
                     headers=_h(admin_tok), timeout=15)
    r.raise_for_status()
    # Keep the ones we care about (there may be leftovers from a prior aborted run).
    by_last: dict = {}
    wanted_last = {last for last, _, _, _ in REAL_PLAYERS} | {last for last, _, _ in PADDING}
    for p in r.json():
        if p["last_name"] in wanted_last:
            by_last[p["last_name"]] = p
    return by_last


def test_fantavoto_matches_real_voti(admin_tok, real_roster):
    """Full flow with real players: build lineup → settle → verify totals."""
    # Build a 4-3-3: 1P + 4D + 3C + 3A + bench 2P+2D+2C+2A
    starters = [
        real_roster["Skorupski"]["id"],          # P
        real_roster["Ahanor"]["id"],             # D
        real_roster["PadD1"]["id"],
        real_roster["PadD2"]["id"],
        real_roster["PadD3"]["id"],
        real_roster["Da Cunha"]["id"],           # C
        real_roster["PadC1"]["id"],
        real_roster["PadC2"]["id"],
        real_roster["Bonazzoli"]["id"],          # A
        real_roster["Douvikas"]["id"],           # A
        real_roster["PadA1"]["id"],
    ]
    bench = [
        real_roster["PadBP1"]["id"], real_roster["PadBP2"]["id"],
        real_roster["PadBD1"]["id"], real_roster["PadBD2"]["id"],
        real_roster["PadBC1"]["id"], real_roster["PadBC2"]["id"],
        real_roster["PadBA1"]["id"], real_roster["PadBA2"]["id"],
    ]
    assert len(starters) == 11 and len(set(starters)) == 11
    assert len(bench) == 8 and len(set(bench)) == 8

    # Create league + join
    r = requests.post(f"{API}/fg/leagues",
                      json={"name": f"REAL_{uuid.uuid4().hex[:5]}"},
                      headers=_h(admin_tok), timeout=15)
    r.raise_for_status()
    lg = r.json()
    tid = lg["id"]

    try:
        tokA = _register_player(f"rvA{uuid.uuid4().hex[:6]}")
        rj = requests.post(f"{API}/fg/leagues/{tid}/join",
                           json={"invite_code": lg["invite_code"]},
                           headers=_h(tokA), timeout=15)
        rj.raise_for_status()

        # Save lineup
        r = requests.post(f"{API}/fg/leagues/{tid}/lineup",
                          json={"matchday": TEST_MATCHDAY,
                                "starters": starters, "bench": bench},
                          headers=_h(tokA), timeout=15)
        assert r.status_code == 200, r.text

        # Settle
        r = requests.post(f"{API}/fg/leagues/{tid}/settle",
                          json={"matchday": TEST_MATCHDAY},
                          headers=_h(admin_tok), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()

        # Only user A has a lineup
        assert data["settled_users"] == 1
        row = [r for r in data["results"] if r["user_id"] is not None][0]

        # Expected total = 10 + 14 + 10 + 3 + 5 = 42.0 (padding all None → 0 contribution)
        expected = 10.0 + 14.0 + 10.0 + 3.0 + 5.0
        assert row["total_fantavoto"] == expected, (
            f"Expected {expected}, got {row['total_fantavoto']}. Results: {data['results']}"
        )

        # Verify per-player breakdown
        r = requests.get(f"{API}/fg/leagues/{tid}/results/{TEST_MATCHDAY}",
                         headers=_h(tokA), timeout=15)
        assert r.status_code == 200
        result = r.json()["results"][0]
        by_pid_fv = {b["player_id"]: b["final_fantavoto"] for b in result["breakdown"]}

        for last, _team, _role, expected_fv in REAL_PLAYERS:
            pid = real_roster[last]["id"]
            assert by_pid_fv[pid] == expected_fv, (
                f"{last}: expected {expected_fv}, got {by_pid_fv[pid]}"
            )

        # Padding starters should be None (no Voti fact match)
        for last, _team, _role in PADDING[:6]:  # 6 padding starters
            pid = real_roster[last]["id"]
            assert by_pid_fv[pid] is None, f"Padding {last} should be None, got {by_pid_fv[pid]}"

    finally:
        requests.delete(f"{API}/fg/leagues/{tid}", headers=_h(admin_tok), timeout=15)
