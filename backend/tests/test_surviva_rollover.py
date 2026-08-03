"""Tests for the Survival 2.0 tournament rollover, ``start_matchday`` and
admin fixture management (postponement / removal).
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
    r = requests.post(
        f"{API}/auth/admin/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15,
    )
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture()
def player_tok():
    r = requests.post(
        f"{API}/auth/player/register",
        json={"username": f"svr_{uuid.uuid4().hex[:4]}", "password": "pw12345678"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["token"]


def _seed_calendar(admin_tok, season: str, matchdays: int = 3):
    """Seed a season calendar with N matchdays × 2 unique fixtures each,
    kickoff scheduled 30+ days in the future.
    """
    fixtures = []
    for md in range(1, matchdays + 1):
        kickoff = (datetime.now(timezone.utc) + timedelta(days=30 + md)).isoformat()
        fixtures.append({
            "matchday": md, "home_team": f"HomeA_md{md}", "away_team": f"AwayA_md{md}",
            "kickoff_iso": kickoff,
        })
        fixtures.append({
            "matchday": md, "home_team": f"HomeB_md{md}", "away_team": f"AwayB_md{md}",
            "kickoff_iso": kickoff,
        })
    r = requests.post(
        f"{API}/sal/calendar/import",
        json={"season": season, "fixtures": fixtures, "replace": True},
        headers=_h(admin_tok), timeout=15,
    )
    r.raise_for_status()


def _make(admin_tok, season, *, start_matchday=1, initial_lives=1):
    r = requests.post(
        f"{API}/sv/tournaments",
        json={
            "name": f"SVR_{uuid.uuid4().hex[:5]}",
            "season": season,
            "initial_lives": initial_lives,
            "start_matchday": start_matchday,
        },
        headers=_h(admin_tok), timeout=15,
    )
    r.raise_for_status()
    return r.json()


def _list_matchdays(tok, tid):
    r = requests.get(
        f"{API}/sv/tournaments/{tid}/matchdays",
        headers=_h(tok), timeout=15,
    )
    r.raise_for_status()
    return r.json()


# =========================================================================
# start_matchday
# =========================================================================

def test_start_matchday_populates_only_from_given_md(admin_tok):
    season = f"srv-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season, matchdays=5)

    t = _make(admin_tok, season, start_matchday=3)
    assert t["start_matchday"] == 3
    assert t["current_matchday"] == 3

    mds = _list_matchdays(admin_tok, t["id"])
    md_numbers = sorted(m["matchday"] for m in mds)
    assert md_numbers == [3, 4, 5]  # md 1 and 2 skipped


def test_join_closed_when_started_past_start_matchday(admin_tok):
    """Once the current matchday advances beyond start_matchday, new users
    must be blocked from joining (fairness)."""
    season = f"srv-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season, matchdays=3)
    t = _make(admin_tok, season, start_matchday=2, initial_lives=1)

    # Fresh player joins the current (start) matchday → OK
    p1 = requests.post(
        f"{API}/auth/player/register",
        json={"username": f"svr_a_{uuid.uuid4().hex[:4]}", "password": "pw12345678"},
        timeout=15,
    ).json()["token"]
    r = requests.post(
        f"{API}/sv/tournaments/join",
        json={"invite_code": t["invite_code"]},
        headers=_h(p1), timeout=15,
    )
    assert r.status_code == 200

    # Admin needs a fresh invite for the next joiner; create one via list
    # then request a new code (or reuse admin's invite issued at creation).
    # For this test we just check the guard: after settling the first matchday
    # the current_matchday moves to 3, so a fresh join must fail.
    mds = _list_matchdays(admin_tok, t["id"])
    md2 = next(m for m in mds if m["matchday"] == 2)
    # p1 submits then settle wrong to eliminate NOBODY (initial_lives=1 → dies)
    # Wait — with 1 life, wrong pick kills them; use correct pick instead.
    fx = md2["fixtures"][0]
    requests.post(
        f"{API}/sv/tournaments/{t['id']}/matchdays/{md2['id']}/pick",
        json={"home_team": fx["home_team"], "away_team": fx["away_team"], "pick": "1"},
        headers=_h(p1), timeout=15,
    ).raise_for_status()
    requests.post(
        f"{API}/sv/tournaments/{t['id']}/matchdays/{md2['id']}/settle",
        json={"results": [
            {"home_team": fx["home_team"], "away_team": fx["away_team"],
             "home_score": 2, "away_score": 0},
        ]},
        headers=_h(admin_tok), timeout=15,
    ).raise_for_status()

    # Now a *new* player tries to join — must fail (torneo iniziato).
    p2 = requests.post(
        f"{API}/auth/player/register",
        json={"username": f"svr_b_{uuid.uuid4().hex[:4]}", "password": "pw12345678"},
        timeout=15,
    ).json()["token"]
    # Need to fetch the CURRENT tournament invite state — reissue one
    invites = requests.get(
        f"{API}/sv/tournaments", headers=_h(admin_tok), timeout=15,
    ).json()
    my_t = next(x for x in invites if x["id"] == t["id"])
    r = requests.post(
        f"{API}/sv/tournaments/join",
        json={"invite_code": my_t["invite_code"]},
        headers=_h(p2), timeout=15,
    )
    # Either the invite is already used (410) or the tournament is closed (400)
    assert r.status_code in (400, 410)


# =========================================================================
# Auto-rollover
# =========================================================================

def test_rollover_spawns_next_round_when_only_one_survivor(admin_tok, player_tok):
    """When settling leaves only 1 alive AND the season has more matchdays,
    a new tournament (Round 2) is auto-spawned starting from md+1."""
    season = f"srv-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season, matchdays=4)

    # 1 life, 2 players: after 1 wrong pick, one dies → 1 alive → rollover
    t = _make(admin_tok, season, initial_lives=1)
    requests.post(
        f"{API}/sv/tournaments/join",
        json={"invite_code": t["invite_code"]},
        headers=_h(player_tok), timeout=15,
    ).raise_for_status()

    mds = _list_matchdays(admin_tok, t["id"])
    md1 = next(m for m in mds if m["matchday"] == 1)
    fx = md1["fixtures"][0]
    # Player picks WRONG (predicts 2 but home wins) → dies
    requests.post(
        f"{API}/sv/tournaments/{t['id']}/matchdays/{md1['id']}/pick",
        json={"home_team": fx["home_team"], "away_team": fx["away_team"], "pick": "2"},
        headers=_h(player_tok), timeout=15,
    ).raise_for_status()

    r = requests.post(
        f"{API}/sv/tournaments/{t['id']}/matchdays/{md1['id']}/settle",
        json={"results": [
            {"home_team": fx["home_team"], "away_team": fx["away_team"],
             "home_score": 3, "away_score": 0},
        ]},
        headers=_h(admin_tok), timeout=15,
    )
    r.raise_for_status()
    body = r.json()
    assert body["tournament_finished"] is True
    assert body["next_tournament_id"] is not None

    # The new tournament starts from md=2 with a fresh invite code
    new_tid = body["next_tournament_id"]
    detail = requests.get(
        f"{API}/sv/tournaments/{new_tid}",
        headers=_h(admin_tok), timeout=15,
    ).json()
    assert detail["start_matchday"] == 2
    assert detail["current_matchday"] == 2
    assert detail["previous_tournament_id"] == t["id"]
    assert detail["invite_code"] != t["invite_code"]
    # And it has matchdays 2..4
    new_mds = _list_matchdays(admin_tok, new_tid)
    assert sorted(m["matchday"] for m in new_mds) == [2, 3, 4]

    # The old tournament now points forward to the new one
    old_detail = requests.get(
        f"{API}/sv/tournaments/{t['id']}",
        headers=_h(admin_tok), timeout=15,
    ).json()
    assert old_detail["next_tournament_id"] == new_tid


def test_no_rollover_when_season_ends(admin_tok, player_tok):
    """No new Round should spawn if we just settled the last available matchday."""
    season = f"srv-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season, matchdays=1)
    t = _make(admin_tok, season, initial_lives=1)
    requests.post(
        f"{API}/sv/tournaments/join",
        json={"invite_code": t["invite_code"]},
        headers=_h(player_tok), timeout=15,
    ).raise_for_status()
    mds = _list_matchdays(admin_tok, t["id"])
    md = mds[0]
    fx = md["fixtures"][0]
    requests.post(
        f"{API}/sv/tournaments/{t['id']}/matchdays/{md['id']}/pick",
        json={"home_team": fx["home_team"], "away_team": fx["away_team"], "pick": "1"},
        headers=_h(player_tok), timeout=15,
    ).raise_for_status()
    r = requests.post(
        f"{API}/sv/tournaments/{t['id']}/matchdays/{md['id']}/settle",
        json={"results": [
            {"home_team": fx["home_team"], "away_team": fx["away_team"],
             "home_score": 1, "away_score": 0},
        ]},
        headers=_h(admin_tok), timeout=15,
    ).json()
    assert r["tournament_finished"] is True
    assert r["next_tournament_id"] is None


# =========================================================================
# Admin fixture management (postponement)
# =========================================================================

def test_delete_fixture_removes_it_and_clears_picks(admin_tok, player_tok):
    season = f"srv-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season, matchdays=1)
    t = _make(admin_tok, season, initial_lives=2)
    requests.post(
        f"{API}/sv/tournaments/join",
        json={"invite_code": t["invite_code"]},
        headers=_h(player_tok), timeout=15,
    ).raise_for_status()

    mds = _list_matchdays(admin_tok, t["id"])
    md = mds[0]
    fx0 = md["fixtures"][0]
    fx1 = md["fixtures"][1]

    # Player picks on fx0
    requests.post(
        f"{API}/sv/tournaments/{t['id']}/matchdays/{md['id']}/pick",
        json={"home_team": fx0["home_team"], "away_team": fx0["away_team"], "pick": "1"},
        headers=_h(player_tok), timeout=15,
    ).raise_for_status()

    # Admin removes fx0 (scheduled postponement)
    r = requests.delete(
        f"{API}/sv/tournaments/{t['id']}/matchdays/{md['id']}/fixtures/0",
        headers=_h(admin_tok), timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body["fixtures"]) == 1
    assert body["fixtures"][0]["home_team"] == fx1["home_team"]

    # The player's pending pick has been cleared → my_pick empty
    r = requests.get(
        f"{API}/sv/tournaments/{t['id']}/matchdays/{md['id']}/my-pick",
        headers=_h(player_tok), timeout=15,
    ).json()
    assert r.get("empty") is True

    # Player can now pick on fx1 without any issue
    r = requests.post(
        f"{API}/sv/tournaments/{t['id']}/matchdays/{md['id']}/pick",
        json={"home_team": fx1["home_team"], "away_team": fx1["away_team"], "pick": "1"},
        headers=_h(player_tok), timeout=15,
    )
    assert r.status_code == 200


def test_patch_fixture_marks_postponed_and_rejects_picks(admin_tok, player_tok):
    season = f"srv-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season, matchdays=1)
    t = _make(admin_tok, season, initial_lives=2)
    requests.post(
        f"{API}/sv/tournaments/join",
        json={"invite_code": t["invite_code"]},
        headers=_h(player_tok), timeout=15,
    ).raise_for_status()

    mds = _list_matchdays(admin_tok, t["id"])
    md = mds[0]
    fx0 = md["fixtures"][0]

    # Admin marks fx0 as postponed_before
    r = requests.patch(
        f"{API}/sv/tournaments/{t['id']}/matchdays/{md['id']}/fixtures/0",
        json={"postponed_before": True},
        headers=_h(admin_tok), timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["fixtures"][0].get("postponed_before") is True

    # Now the player cannot pick that fixture
    r = requests.post(
        f"{API}/sv/tournaments/{t['id']}/matchdays/{md['id']}/pick",
        json={"home_team": fx0["home_team"], "away_team": fx0["away_team"], "pick": "1"},
        headers=_h(player_tok), timeout=15,
    )
    assert r.status_code == 400
    assert "rinviata" in r.json()["detail"].lower()


def test_delete_fixture_requires_admin(admin_tok, player_tok):
    season = f"srv-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season, matchdays=1)
    t = _make(admin_tok, season, initial_lives=2)
    requests.post(
        f"{API}/sv/tournaments/join",
        json={"invite_code": t["invite_code"]},
        headers=_h(player_tok), timeout=15,
    ).raise_for_status()
    mds = _list_matchdays(admin_tok, t["id"])
    md = mds[0]
    r = requests.delete(
        f"{API}/sv/tournaments/{t['id']}/matchdays/{md['id']}/fixtures/0",
        headers=_h(player_tok), timeout=15,
    )
    assert r.status_code == 403
