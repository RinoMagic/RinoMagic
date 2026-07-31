"""Add-on tests for the derived team-results endpoint.

We import the sample PDF into matchday 37 (via `matchday_override`) to avoid
interfering with `test_matchday_facts.py` which owns matchday 38.
"""
import os
import pathlib
import requests
import pytest


API = os.environ.get("API_BASE_URL", "http://localhost:8001") + "/api"

ADMIN_EMAIL = "verone.salvatore@libero.it"
ADMIN_PASSWORD = "SchedinaBar2026!"

FIXTURE_PDF = pathlib.Path(__file__).parent / "fixtures" / "voti_giornata_38.pdf"
TEST_MATCHDAY = 37  # isolated from other test modules


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


@pytest.fixture(autouse=True)
def _seed(admin_tok):
    """Import the sample PDF as matchday 37 before each test."""
    with FIXTURE_PDF.open("rb") as f:
        r = requests.post(
            f"{API}/admin/voti/upload-pdf",
            params={
                "dry_run": "false",
                "replace": "true",
                "matchday_override": TEST_MATCHDAY,
            },
            files={"file": ("voti.pdf", f, "application/pdf")},
            headers=_h(admin_tok),
            timeout=60,
        )
    r.raise_for_status()
    yield
    # cleanup
    requests.delete(f"{API}/admin/voti/{TEST_MATCHDAY}", headers=_h(admin_tok), timeout=10)


def test_team_results_shape(admin_tok):
    r = requests.get(f"{API}/admin/voti/{TEST_MATCHDAY}/team-results", headers=_h(admin_tok), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["matchday"] == TEST_MATCHDAY
    assert len(d["teams"]) == 20
    for t in d["teams"]:
        assert set(t.keys()) >= {
            "team", "goals_scored_openplay", "goals_conceded",
            "own_goals", "red_cards", "yellow_cards",
            "players_graded", "players_total",
        }
        assert t["players_total"] == 17


def test_team_results_consistency(admin_tok):
    r = requests.get(f"{API}/admin/voti/{TEST_MATCHDAY}/team-results", headers=_h(admin_tok), timeout=15)
    d = r.json()
    s = d["sanity"]
    assert s["goals_scored_openplay"] == 26
    assert s["own_goals"] == 2
    assert s["implied_total_goals"] == 28
    assert s["gk_goals_conceded"] == 28
    assert s["consistent"] is True


def test_specific_teams(admin_tok):
    r = requests.get(f"{API}/admin/voti/{TEST_MATCHDAY}/team-results", headers=_h(admin_tok), timeout=15)
    teams = {t["team"]: t for t in r.json()["teams"]}
    assert teams["Como"]["goals_scored_openplay"] == 4
    assert teams["Cremonese"]["goals_scored_openplay"] == 1
    assert teams["Cagliari"]["goals_conceded"] == 1
    assert teams["Cremonese"]["goals_conceded"] == 4


def test_returns_404_for_missing_matchday(admin_tok):
    # 36 shouldn't be seeded by anyone
    requests.delete(f"{API}/admin/voti/36", headers=_h(admin_tok), timeout=10)
    r = requests.get(f"{API}/admin/voti/36/team-results", headers=_h(admin_tok), timeout=15)
    assert r.status_code == 404


def test_risultati_endpoint_removed(admin_tok):
    """The old stub Risultati endpoint must be gone (derived from voti now)."""
    r = requests.post(
        f"{API}/admin/risultati/upload-pdf",
        files={"file": ("x.pdf", b"%PDF-1.4\n", "application/pdf")},
        headers=_h(admin_tok),
        timeout=10,
    )
    assert r.status_code == 404
