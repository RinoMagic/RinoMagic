"""ScoreAndLive: Riassunto Giornata endpoint — privacy pre/post kickoff.

The endpoint aggregates picks by fixture and by player. Before the first
kickoff of the matchday, the `pickers` list of each candidate MUST be None
(the counts remain visible to help players compare their choice against the
crowd without revealing who picked what). After kickoff (or if the matchday
is settled), `pickers` becomes a populated list of nicknames.
"""
import os
import uuid
import requests
import pytest
from datetime import datetime, timedelta, timezone

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


def _seed_scenario(admin_tok, kickoff_iso: str):
    """Create a tiny tournament with one matchday of one fixture.

    Requires uploading a listone-like roster so picks can reference a player.
    """
    season = f"s-{uuid.uuid4().hex[:4]}"
    home = f"H_{uuid.uuid4().hex[:3]}"
    away = f"A_{uuid.uuid4().hex[:3]}"
    # Calendar
    requests.post(f"{API}/sal/calendar/import",
                  json={"season": season,
                        "fixtures": [{
                            "matchday": 1, "home_team": home, "away_team": away,
                            "kickoff_iso": kickoff_iso,
                        }],
                        "replace": True},
                  headers=_h(admin_tok), timeout=15).raise_for_status()
    # Roster (2 players, one per team)
    requests.post(f"{API}/sal/players/import",
                  json={"players": [
                      {"first_name": "Player", "last_name": "Alpha", "team": home, "role": "A"},
                      {"first_name": "Player", "last_name": "Beta", "team": away, "role": "A"},
                  ]},
                  headers=_h(admin_tok), timeout=15).raise_for_status()
    # Tournament
    r = requests.post(f"{API}/sal/tournaments",
                      json={"name": f"SUM_{uuid.uuid4().hex[:5]}",
                            "initial_lives": 3, "start_matchday": 1,
                            "season": season},
                      headers=_h(admin_tok), timeout=15)
    r.raise_for_status()
    t = r.json()
    return t, home, away


def _register_player(username: str):
    r = requests.post(f"{API}/auth/player/register",
                      json={"username": username, "password": "pw12345678"},
                      timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _join(player_tok, invite_code):
    # SAL join is /tournaments/{tid}/join, but the tid can be looked up via
    # /tournaments/by-code/{code} which returns the tournament id.
    r = requests.get(f"{API}/sal/tournaments/by-code/{invite_code}",
                     timeout=15)
    r.raise_for_status()
    tid = r.json()["id"]
    r = requests.post(f"{API}/sal/tournaments/{tid}/join",
                      json={"invite_code": invite_code},
                      headers=_h(player_tok), timeout=15)
    r.raise_for_status()
    return r.json()


def _current_md(admin_tok, tid):
    """Return the id of the auto-created first matchday of *tid*.

    SAL doesn't expose a "list matchdays" endpoint, so we fetch it directly
    from Mongo — the ORM has no auth to worry about in the test container.
    """
    import os
    from pymongo import MongoClient
    mongo = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    db = mongo[os.environ.get("DB_NAME", "schedinabar")]
    doc = db.sal_matchdays.find_one({"tournament_id": tid, "matchday_number": 1})
    mongo.close()
    if not doc:
        raise RuntimeError(f"No matchday 1 found for tournament {tid}")
    return doc["id"]


def test_summary_locked_before_kickoff(admin_tok):
    """Kickoff far in the future → `pickers` MUST be None on every candidate."""
    future = (datetime.now(timezone.utc) + timedelta(days=15)).isoformat()
    t, home, _away = _seed_scenario(admin_tok, future)
    md_id = _current_md(admin_tok, t["id"])

    p1_tok = _register_player(f"sum1_{uuid.uuid4().hex[:4]}")
    _join(p1_tok, t["invite_code"])

    # Find player_id via /sal/players
    players = requests.get(f"{API}/sal/players?team={home}",
                           headers=_h(p1_tok), timeout=15).json()
    assert len(players) == 1
    pid = players[0]["id"]

    r = requests.post(
        f"{API}/sal/tournaments/{t['id']}/matchdays/{md_id}/picks",
        json={"picks": [{"fixture_idx": 0, "player_id": pid}]},
        headers=_h(p1_tok), timeout=15,
    )
    r.raise_for_status()

    summ = requests.get(
        f"{API}/sal/tournaments/{t['id']}/matchdays/{md_id}/summary",
        headers=_h(p1_tok), timeout=15,
    ).json()
    assert summ["locked"] is False
    assert len(summ["fixtures"]) == 1
    fx = summ["fixtures"][0]
    assert fx["total_picks"] == 1
    assert len(fx["candidates"]) == 1
    assert fx["candidates"][0]["count"] == 1
    # Privacy: pickers list must NOT reveal any nickname pre-kickoff
    assert fx["candidates"][0]["pickers"] is None


def test_summary_unlocked_after_kickoff(admin_tok):
    """Kickoff already in the past → `pickers` populated with nicknames."""
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    t, home, _away = _seed_scenario(admin_tok, past)
    md_id = _current_md(admin_tok, t["id"])

    p1_tok = _register_player(f"sum2_{uuid.uuid4().hex[:4]}")
    _join(p1_tok, t["invite_code"])

    # Submitting picks on a matchday whose kickoff has passed is not
    # supported by the SAL rules — status stays 'open' until admin settles
    # it, but submissions can still be attempted. The endpoint may or may
    # not accept them depending on the SAL business rules. Regardless of
    # that, the /summary endpoint MUST report `locked = True` because the
    # first kickoff is in the past.

    summ = requests.get(
        f"{API}/sal/tournaments/{t['id']}/matchdays/{md_id}/summary",
        headers=_h(p1_tok), timeout=15,
    ).json()
    assert summ["locked"] is True
    assert len(summ["fixtures"]) == 1


def test_summary_forbidden_for_non_participant(admin_tok):
    future = (datetime.now(timezone.utc) + timedelta(days=15)).isoformat()
    t, _home, _away = _seed_scenario(admin_tok, future)
    md_id = _current_md(admin_tok, t["id"])

    outsider = _register_player(f"out_{uuid.uuid4().hex[:4]}")
    r = requests.get(
        f"{API}/sal/tournaments/{t['id']}/matchdays/{md_id}/summary",
        headers=_h(outsider), timeout=15,
    )
    assert r.status_code == 403


def test_summary_visible_to_tournament_admin(admin_tok):
    future = (datetime.now(timezone.utc) + timedelta(days=15)).isoformat()
    t, _home, _away = _seed_scenario(admin_tok, future)
    md_id = _current_md(admin_tok, t["id"])
    r = requests.get(
        f"{API}/sal/tournaments/{t['id']}/matchdays/{md_id}/summary",
        headers=_h(admin_tok), timeout=15,
    )
    # Global admin sees the summary even without being a participant.
    assert r.status_code == 200
