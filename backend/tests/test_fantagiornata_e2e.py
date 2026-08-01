"""End-to-end integration tests for FantaGiornata.

Uses the real Voti PDF fixture (matchday 38) previously validated. This test
locks in the whole pipeline:

    1. Admin creates a league
    2. Admin registers 3 players (mocked roster: pull from sal_players)
    3. Users join with single-use invites
    4. Users submit lineups (11 starters + 8 bench)
    5. Admin imports Voti PDF → matchday_facts populated
    6. Admin triggers settle → fantavoto computed
    7. Leaderboard reflects the results
"""
from __future__ import annotations

import os, pathlib, uuid, requests, pytest


API = os.environ.get("API_BASE_URL", "http://localhost:8001") + "/api"

ADMIN_EMAIL = "verone.salvatore@libero.it"
ADMIN_PASSWORD = "SchedinaBar2026!"

FIXTURE_PDF = pathlib.Path(__file__).parent / "fixtures" / "voti_giornata_38.pdf"

# Isolate from other test modules: import Voti as matchday 30 (nobody else uses it).
TEST_MATCHDAY = 30


def _login(email, password):
    r = requests.post(f"{API}/auth/admin/login",
                      json={"email": email, "password": password}, timeout=15)
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
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def voti_imported(admin_tok):
    """Import matchday 30 voti (using the sample PDF w/ matchday_override)."""
    with FIXTURE_PDF.open("rb") as f:
        r = requests.post(
            f"{API}/admin/voti/upload-pdf",
            params={"dry_run": "false", "replace": "true",
                    "matchday_override": TEST_MATCHDAY},
            files={"file": ("voti.pdf", f, "application/pdf")},
            headers=_h(admin_tok), timeout=60,
        )
    r.raise_for_status()
    yield
    requests.delete(f"{API}/admin/voti/{TEST_MATCHDAY}", headers=_h(admin_tok), timeout=10)


@pytest.fixture(scope="module")
def roster(admin_tok):
    """Seed a small demo roster used by lineups.

    We use a unique prefix ("FGZ") in the last names so this roster can coexist
    with other test modules' rosters (some of them use ``replace_all=True``).
    The importer is called with ``replace_all=False`` to preserve concurrent data.
    """
    players = []
    teams = ["Inter", "Juventus", "Milan", "Napoli", "Roma", "Lazio",
             "Atalanta", "Bologna", "Torino", "Como"]
    for tm in teams:
        for i in range(3):
            players.append({"first_name": "FGZ", "last_name": f"FGZ{tm}Port{i}", "team": tm, "role": "P"})
        for i in range(5):
            players.append({"first_name": "FGZ", "last_name": f"FGZ{tm}Def{i}", "team": tm, "role": "D"})
        for i in range(5):
            players.append({"first_name": "FGZ", "last_name": f"FGZ{tm}Mid{i}", "team": tm, "role": "C"})
        for i in range(3):
            players.append({"first_name": "FGZ", "last_name": f"FGZ{tm}Att{i}", "team": tm, "role": "A"})
    r = requests.post(f"{API}/sal/players/import",
                      json={"replace_all": False, "players": players},
                      headers=_h(admin_tok), timeout=30)
    r.raise_for_status()
    # Fetch our subset back via the `q` regex filter (matches full_name).
    r = requests.get(f"{API}/sal/players?q=FGZ&limit=200",
                     headers=_h(admin_tok), timeout=15)
    r.raise_for_status()
    return r.json()


@pytest.fixture
def league_with_users(admin_tok, roster):
    """Create a league, register 2 players, both joined."""
    r = requests.post(f"{API}/fg/leagues",
                      json={"name": f"L_{uuid.uuid4().hex[:5]}"},
                      headers=_h(admin_tok), timeout=15)
    r.raise_for_status()
    lg = r.json()
    tok_a = _register_player(f"fgA{uuid.uuid4().hex[:6]}")
    tok_b = _register_player(f"fgB{uuid.uuid4().hex[:6]}")

    # A joins with initial invite
    rj = requests.post(f"{API}/fg/leagues/{lg['id']}/join",
                       json={"invite_code": lg["invite_code"]},
                       headers=_h(tok_a), timeout=15)
    rj.raise_for_status()

    # B needs a fresh invite (single-use!)
    r = requests.post(f"{API}/fg/leagues/{lg['id']}/invites",
                      headers=_h(admin_tok), timeout=15)
    r.raise_for_status()
    fresh = r.json()["code"]
    rj = requests.post(f"{API}/fg/leagues/{lg['id']}/join",
                       json={"invite_code": fresh},
                       headers=_h(tok_b), timeout=15)
    rj.raise_for_status()

    yield lg, tok_a, tok_b
    requests.delete(f"{API}/fg/leagues/{lg['id']}", headers=_h(admin_tok), timeout=15)


# ------------------------------------------------------------------
# CRUD + invites
# ------------------------------------------------------------------

class TestLeagueCRUD:
    def test_create_lists_and_deletes(self, admin_tok, roster):
        r = requests.post(f"{API}/fg/leagues", json={"name": "TmpL"},
                          headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200
        lg = r.json()
        assert lg["invites_available"] == 1  # initial invite created
        assert lg["members_count"] == 1       # admin auto-enrolled
        # List
        r = requests.get(f"{API}/fg/leagues", headers=_h(admin_tok), timeout=15)
        assert lg["id"] in {x["id"] for x in r.json()}
        # Delete
        r = requests.delete(f"{API}/fg/leagues/{lg['id']}", headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200

    def test_single_use_invite_regression(self, admin_tok, roster):
        r = requests.post(f"{API}/fg/leagues", json={"name": "SU"},
                          headers=_h(admin_tok), timeout=15).json()
        try:
            tokA = _register_player(f"suA{uuid.uuid4().hex[:6]}")
            tokB = _register_player(f"suB{uuid.uuid4().hex[:6]}")
            code = r["invite_code"]
            j = requests.post(f"{API}/fg/leagues/{r['id']}/join",
                              json={"invite_code": code}, headers=_h(tokA), timeout=15)
            assert j.status_code == 200
            j = requests.post(f"{API}/fg/leagues/{r['id']}/join",
                              json={"invite_code": code}, headers=_h(tokB), timeout=15)
            assert j.status_code == 410
        finally:
            requests.delete(f"{API}/fg/leagues/{r['id']}", headers=_h(admin_tok), timeout=15)


# ------------------------------------------------------------------
# Lineups
# ------------------------------------------------------------------

def _build_lineup(roster: list, seed_team_offset: int = 0):
    """Build a valid 4-3-3 lineup (1P+4D+3C+3A) + bench (2P+2D+2C+2A) from roster.

    Simple strategy: index by role, take slices starting from ``seed_team_offset``.
    """
    by_role = {"P": [], "D": [], "C": [], "A": []}
    for p in roster:
        if p["role"] in by_role:
            by_role[p["role"]].append(p)
    # Need at least: 3 P (1 starter + 2 bench), 6 D, 5 C, 5 A
    assert len(by_role["P"]) >= 3 + seed_team_offset, f"Not enough P in roster (have {len(by_role['P'])})"
    assert len(by_role["D"]) >= 6 + seed_team_offset
    assert len(by_role["C"]) >= 5 + seed_team_offset
    assert len(by_role["A"]) >= 5 + seed_team_offset

    starters = (
        [by_role["P"][seed_team_offset]["id"]]
        + [p["id"] for p in by_role["D"][seed_team_offset:seed_team_offset+4]]
        + [p["id"] for p in by_role["C"][seed_team_offset:seed_team_offset+3]]
        + [p["id"] for p in by_role["A"][seed_team_offset:seed_team_offset+3]]
    )
    bench = (
        [p["id"] for p in by_role["P"][seed_team_offset+1:seed_team_offset+3]]
        + [p["id"] for p in by_role["D"][seed_team_offset+4:seed_team_offset+6]]
        + [p["id"] for p in by_role["C"][seed_team_offset+3:seed_team_offset+5]]
        + [p["id"] for p in by_role["A"][seed_team_offset+3:seed_team_offset+5]]
    )
    assert len(starters) == 11 and len(set(starters)) == 11, f"Bad starters: {len(starters)}"
    assert len(bench) == 8 and len(set(bench)) == 8, f"Bad bench: {len(bench)}"
    return starters, bench


class TestLineup:
    def test_save_and_read_back(self, admin_tok, roster, league_with_users):
        lg, tokA, tokB = league_with_users
        starters, bench = _build_lineup(roster)
        r = requests.post(f"{API}/fg/leagues/{lg['id']}/lineup",
                          json={"matchday": TEST_MATCHDAY,
                                "starters": starters, "bench": bench},
                          headers=_h(tokA), timeout=15)
        assert r.status_code == 200, r.text
        # Read back
        r = requests.get(f"{API}/fg/leagues/{lg['id']}/lineup/{TEST_MATCHDAY}",
                         headers=_h(tokA), timeout=15)
        assert r.status_code == 200
        assert r.json()["starters"] == starters
        assert r.json()["bench"] == bench

    def test_bench_wrong_composition_rejected(self, admin_tok, roster, league_with_users):
        lg, tokA, _ = league_with_users
        starters, bench = _build_lineup(roster)
        bad = bench.copy()
        bad[0] = starters[0]  # duplicate id
        r = requests.post(f"{API}/fg/leagues/{lg['id']}/lineup",
                          json={"matchday": TEST_MATCHDAY,
                                "starters": starters, "bench": bad},
                          headers=_h(tokA), timeout=15)
        assert r.status_code == 400

    def test_module_persisted_and_returned(self, admin_tok, roster, league_with_users):
        """Saving a lineup with a `module` hint persists it and returns it verbatim."""
        lg, tokA, _ = league_with_users
        starters, bench = _build_lineup(roster)  # 4-3-3 by construction
        r = requests.post(f"{API}/fg/leagues/{lg['id']}/lineup",
                          json={"matchday": TEST_MATCHDAY,
                                "starters": starters, "bench": bench,
                                "module": "4-3-3"},
                          headers=_h(tokA), timeout=15)
        assert r.status_code == 200, r.text
        r = requests.get(f"{API}/fg/leagues/{lg['id']}/lineup/{TEST_MATCHDAY}",
                         headers=_h(tokA), timeout=15)
        assert r.status_code == 200
        assert r.json().get("module") == "4-3-3"

    def test_module_unknown_rejected(self, admin_tok, roster, league_with_users):
        lg, tokA, _ = league_with_users
        starters, bench = _build_lineup(roster)
        r = requests.post(f"{API}/fg/leagues/{lg['id']}/lineup",
                          json={"matchday": TEST_MATCHDAY,
                                "starters": starters, "bench": bench,
                                "module": "6-0-4"},
                          headers=_h(tokA), timeout=15)
        assert r.status_code == 422 or r.status_code == 400  # pydantic validator

    def test_module_mismatch_rejected(self, admin_tok, roster, league_with_users):
        """4-3-3 starters + module="3-5-2" must be rejected."""
        lg, tokA, _ = league_with_users
        starters, bench = _build_lineup(roster)  # 4-3-3 shape
        r = requests.post(f"{API}/fg/leagues/{lg['id']}/lineup",
                          json={"matchday": TEST_MATCHDAY,
                                "starters": starters, "bench": bench,
                                "module": "3-5-2"},
                          headers=_h(tokA), timeout=15)
        assert r.status_code == 400
        assert "modulo" in r.json()["detail"].lower() or "3-5-2" in r.json()["detail"]


# ------------------------------------------------------------------
# End-to-end settle using real Voti PDF
# ------------------------------------------------------------------

class TestSettleE2E:
    """The demo roster last-names (``FGZ<team><role><i>``) won't match any real
    player in the Voti PDF — so all lookups return None. This is intentional:
    the pipeline must still run end-to-end without exceptions, producing zero
    scores for everyone. It proves the plumbing works; separate unit tests
    already lock in the fantavoto calculation itself."""

    def test_settle_pipeline_runs(self, admin_tok, roster, voti_imported, league_with_users):
        lg, tokA, tokB = league_with_users
        starters_a, bench_a = _build_lineup(roster, seed_team_offset=0)
        starters_b, bench_b = _build_lineup(roster, seed_team_offset=6)

        for tok, s, b in [(tokA, starters_a, bench_a), (tokB, starters_b, bench_b)]:
            r = requests.post(f"{API}/fg/leagues/{lg['id']}/lineup",
                              json={"matchday": TEST_MATCHDAY,
                                    "starters": s, "bench": b},
                              headers=_h(tok), timeout=15)
            assert r.status_code == 200, r.text

        # Settle
        r = requests.post(f"{API}/fg/leagues/{lg['id']}/settle",
                          json={"matchday": TEST_MATCHDAY},
                          headers=_h(admin_tok), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["settled_users"] == 2
        assert all("total_fantavoto" in row for row in data["results"])

        # Results endpoint
        r = requests.get(f"{API}/fg/leagues/{lg['id']}/results/{TEST_MATCHDAY}",
                         headers=_h(tokA), timeout=15)
        assert r.status_code == 200
        assert len(r.json()["results"]) == 2

        # Leaderboard
        r = requests.get(f"{API}/fg/leagues/{lg['id']}/leaderboard",
                         headers=_h(tokA), timeout=15)
        assert r.status_code == 200
        assert len(r.json()["leaderboard"]) >= 2

    def test_settle_requires_voti(self, admin_tok, roster, league_with_users):
        """Settling a matchday with no voti imported → 400."""
        lg, _tokA, _tokB = league_with_users
        r = requests.post(f"{API}/fg/leagues/{lg['id']}/settle",
                          json={"matchday": 15},
                          headers=_h(admin_tok), timeout=15)
        assert r.status_code == 400
        assert "voto" in r.json()["detail"].lower() or "voti" in r.json()["detail"].lower()
