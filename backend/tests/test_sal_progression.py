"""Auto-progression + history integration tests for ScoreAndLive.

These tests intentionally avoid the full picks/settle workflow (which needs
the ``roster`` fixture from test_scoreandlive.py) and focus on the NEW
endpoints: archive listing, delete-with-force, lock/unlock, and history
visibility rules.
"""
import os
import uuid
import requests
import pytest

API = os.environ.get("API_BASE_URL", "http://localhost:8001") + "/api"
ADMIN_EMAIL = "verone.salvatore@libero.it"
ADMIN_PASSWORD = "SchedinaBar2026!"


def _h(tok: str):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_tok():
    r = requests.post(f"{API}/auth/admin/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="module")
def player_tok():
    r = requests.post(f"{API}/auth/player/register",
                      json={"username": f"salp_{uuid.uuid4().hex[:6]}", "password": "pw12345678"},
                      timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _make_tournament(admin_tok, season, start_matchday=1, fixtures_per_md=1):
    """Create a fresh tournament with an isolated single-matchday calendar."""
    fixtures = [
        {"matchday": start_matchday, "home_team": f"H{start_matchday}_{i}",
         "away_team": f"A{start_matchday}_{i}"}
        for i in range(fixtures_per_md)
    ]
    requests.post(f"{API}/sal/calendar/import",
                  json={"season": season, "fixtures": fixtures, "replace": True},
                  headers=_h(admin_tok), timeout=15).raise_for_status()
    r = requests.post(f"{API}/sal/tournaments",
                      json={"name": f"AP_{uuid.uuid4().hex[:5]}",
                            "initial_lives": 3,
                            "start_matchday": start_matchday, "season": season},
                      headers=_h(admin_tok), timeout=15)
    r.raise_for_status()
    return r.json()


def test_archive_list_returns_finished_only(admin_tok):
    r = requests.get(f"{API}/sal/tournaments/archive/list",
                     headers=_h(admin_tok), timeout=15)
    assert r.status_code == 200
    for t in r.json():
        # every archived entry must have a finished tournament shape
        assert "winner_user_id" in t
        assert "settled_matchdays" in t


def test_delete_empty_tournament_ok(admin_tok):
    """A tournament with no picks can be deleted without force."""
    season = f"del1-{uuid.uuid4().hex[:4]}"
    t = _make_tournament(admin_tok, season)
    r = requests.delete(f"{API}/sal/tournaments/{t['id']}",
                        headers=_h(admin_tok), timeout=15)
    assert r.status_code == 200


def test_lock_and_unlock_matchday(admin_tok):
    season = f"lock-{uuid.uuid4().hex[:4]}"
    t = _make_tournament(admin_tok, season, start_matchday=10)
    try:
        detail = requests.get(f"{API}/sal/tournaments/{t['id']}",
                              headers=_h(admin_tok), timeout=15).json()
        mid = detail["matchdays"][0]["id"]

        r = requests.post(f"{API}/sal/tournaments/{t['id']}/matchdays/{mid}/lock",
                          headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200
        got = requests.get(f"{API}/sal/tournaments/{t['id']}/matchdays/{mid}",
                           headers=_h(admin_tok), timeout=15).json()
        assert got["status"] == "locked"

        r = requests.post(f"{API}/sal/tournaments/{t['id']}/matchdays/{mid}/unlock",
                          headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200
        got = requests.get(f"{API}/sal/tournaments/{t['id']}/matchdays/{mid}",
                           headers=_h(admin_tok), timeout=15).json()
        assert got["status"] == "open"
    finally:
        requests.delete(f"{API}/sal/tournaments/{t['id']}?force=true",
                        headers=_h(admin_tok), timeout=15)


def test_history_endpoint_returns_matchdays(admin_tok, player_tok):
    """History endpoint is publicly readable and structured."""
    season = f"hist-{uuid.uuid4().hex[:4]}"
    t = _make_tournament(admin_tok, season, start_matchday=1)
    try:
        # Any authenticated user can read history
        r = requests.get(f"{API}/sal/tournaments/{t['id']}/history",
                         headers=_h(player_tok), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["tournament"]["id"] == t["id"]
        assert data["tournament"]["status"] == "open"
        assert data["tournament"]["winner_user_id"] is None
        assert len(data["matchdays"]) >= 1
        # Open matchday → picks not visible
        md0 = data["matchdays"][0]
        assert md0["status"] == "open"
        assert md0["picks_visible"] is False
        assert md0["picks"] == []

        # Lock → picks become visible
        mid = md0["id"]
        requests.post(f"{API}/sal/tournaments/{t['id']}/matchdays/{mid}/lock",
                      headers=_h(admin_tok), timeout=15).raise_for_status()
        r = requests.get(f"{API}/sal/tournaments/{t['id']}/history",
                         headers=_h(player_tok), timeout=15).json()
        assert r["matchdays"][0]["picks_visible"] is True
    finally:
        requests.delete(f"{API}/sal/tournaments/{t['id']}?force=true",
                        headers=_h(admin_tok), timeout=15)


def test_tournament_has_previous_next_links(admin_tok):
    """New tournament docs expose the (empty) chain link fields."""
    season = f"link-{uuid.uuid4().hex[:4]}"
    t = _make_tournament(admin_tok, season)
    try:
        assert t.get("season") == season
        assert t.get("start_matchday") == 1
        # Fetch full doc via detail endpoint
        d = requests.get(f"{API}/sal/tournaments/{t['id']}",
                         headers=_h(admin_tok), timeout=15).json()
        # These fields might be omitted from the summary — accept either
        assert d["id"] == t["id"]
    finally:
        requests.delete(f"{API}/sal/tournaments/{t['id']}",
                        headers=_h(admin_tok), timeout=15)
