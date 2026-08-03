"""End-to-end integration tests for Surviva 2.0.

Cover the full lifecycle:
- Tournament creation (auto-populates matchdays from calendar)
- Join via invite code
- Submit a single pick per matchday
- Blocked-sign rule prevents re-using a guessed (team, outcome)
- Settlement decrements lives on wrong picks, blocks signs on correct ones
- Elimination at 0 lives
- Auto-progression to the next matchday
- Riassunto Giornata privacy: aggregates only until kickoff
- History archive lists only finished tournaments
"""
import os
import uuid
import time
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


@pytest.fixture()
def player_tok():
    """A fresh player per test to keep state isolated."""
    r = requests.post(f"{API}/auth/player/register",
                      json={"username": f"svp_{uuid.uuid4().hex[:4]}",
                            "password": "pw12345678"},
                      timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _seed_calendar(admin_tok, season: str, matchdays: int = 3):
    """Reset the season calendar to `matchdays` × 2 fixtures per matchday.

    Uses distinct team names per matchday to avoid the blocked-sign rule
    interfering across matchdays in tests that don't exercise it.
    """
    fixtures = []
    for md in range(1, matchdays + 1):
        # Kickoff far in the future so the matchday stays "open" for picks.
        kickoff = (datetime.now(timezone.utc) + timedelta(days=30 + md)).isoformat()
        fixtures.append({
            "matchday": md, "home_team": f"HomeA_md{md}", "away_team": f"AwayA_md{md}",
            "kickoff_iso": kickoff,
        })
        fixtures.append({
            "matchday": md, "home_team": f"HomeB_md{md}", "away_team": f"AwayB_md{md}",
            "kickoff_iso": kickoff,
        })
    r = requests.post(f"{API}/sal/calendar/import",
                      json={"season": season, "fixtures": fixtures, "replace": True},
                      headers=_h(admin_tok), timeout=15)
    r.raise_for_status()


def _make_tournament(admin_tok, season: str, initial_lives: int = 3):
    r = requests.post(f"{API}/sv/tournaments",
                      json={"name": f"SV_{uuid.uuid4().hex[:5]}",
                            "season": season,
                            "initial_lives": initial_lives},
                      headers=_h(admin_tok), timeout=15)
    r.raise_for_status()
    return r.json()


def _join(player_tok, invite_code: str):
    r = requests.post(f"{API}/sv/tournaments/join",
                      json={"invite_code": invite_code},
                      headers=_h(player_tok), timeout=15)
    r.raise_for_status()
    return r.json()


def _current_md(player_tok, tid: str):
    r = requests.get(f"{API}/sv/tournaments/{tid}/matchdays/current",
                     headers=_h(player_tok), timeout=15)
    r.raise_for_status()
    return r.json()


def _submit_pick(player_tok, tid, md_id, home, away, pick):
    r = requests.post(f"{API}/sv/tournaments/{tid}/matchdays/{md_id}/pick",
                      json={"home_team": home, "away_team": away, "pick": pick},
                      headers=_h(player_tok), timeout=15)
    return r


def _settle(admin_tok, tid, md_id, results):
    r = requests.post(f"{API}/sv/tournaments/{tid}/matchdays/{md_id}/settle",
                      json={"results": results},
                      headers=_h(admin_tok), timeout=15)
    r.raise_for_status()
    return r.json()


# =========================================================================
# Tests
# =========================================================================

def test_create_tournament_populates_matchdays(admin_tok):
    season = f"t-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season, matchdays=3)
    t = _make_tournament(admin_tok, season)
    assert t["invite_code"]
    assert t["initial_lives"] == 3
    assert t["current_matchday"] == 1
    # Admin is auto-joined
    assert t["joined"] is True

    # 3 matchdays populated
    r = requests.get(f"{API}/sv/tournaments/{t['id']}/matchdays",
                     headers=_h(admin_tok), timeout=15)
    r.raise_for_status()
    mds = r.json()
    assert len(mds) == 3
    md_numbers = sorted(m["matchday"] for m in mds)
    assert md_numbers == [1, 2, 3]
    # Each matchday has 2 fixtures (from _seed_calendar)
    for m in mds:
        assert len(m["fixtures"]) == 2


def test_join_via_invite(admin_tok, player_tok):
    season = f"t-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    t = _make_tournament(admin_tok, season)
    joined = _join(player_tok, t["invite_code"])
    assert joined["joined"] is True

    # Second attempt with same code from another player must be rejected
    other = requests.post(f"{API}/auth/player/register",
                          json={"username": f"o_{uuid.uuid4().hex[:4]}",
                                "password": "pw12345678"}, timeout=15).json()["token"]
    r = requests.post(f"{API}/sv/tournaments/join",
                      json={"invite_code": t["invite_code"]},
                      headers=_h(other), timeout=15)
    assert r.status_code in (400, 410)


def test_pick_submit_and_read(admin_tok, player_tok):
    season = f"t-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    t = _make_tournament(admin_tok, season)
    _join(player_tok, t["invite_code"])
    md = _current_md(player_tok, t["id"])
    fx = md["fixtures"][0]

    r = _submit_pick(player_tok, t["id"], md["id"], fx["home_team"], fx["away_team"], "1")
    assert r.status_code == 200, r.text

    # Read back
    r = requests.get(
        f"{API}/sv/tournaments/{t['id']}/matchdays/{md['id']}/my-pick",
        headers=_h(player_tok), timeout=15,
    )
    r.raise_for_status()
    my = r.json()
    assert my["pick"] == "1"
    assert my["home_team"] == fx["home_team"]

    # Re-submit for the SAME matchday overrides the previous pick (still ONE per matchday)
    fx2 = md["fixtures"][1]
    r = _submit_pick(player_tok, t["id"], md["id"], fx2["home_team"], fx2["away_team"], "X")
    assert r.status_code == 200
    r = requests.get(
        f"{API}/sv/tournaments/{t['id']}/matchdays/{md['id']}/my-pick",
        headers=_h(player_tok), timeout=15,
    )
    my2 = r.json()
    assert my2["home_team"] == fx2["home_team"]
    assert my2["pick"] == "X"


def test_settle_wrong_pick_loses_life(admin_tok, player_tok):
    season = f"t-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    t = _make_tournament(admin_tok, season, initial_lives=3)
    _join(player_tok, t["invite_code"])
    md = _current_md(player_tok, t["id"])
    fx = md["fixtures"][0]

    # Player picks "1" but the actual result is 0-2 (away wins).
    _submit_pick(player_tok, t["id"], md["id"], fx["home_team"], fx["away_team"], "1")
    settle_res = _settle(admin_tok, t["id"], md["id"], results=[
        {"home_team": fx["home_team"], "away_team": fx["away_team"],
         "home_score": 0, "away_score": 2},
    ])
    assert settle_res["ok"] is True
    assert settle_res["stats"]["wrong"] == 1

    # Player has 2 lives left (started at 3)
    lb = requests.get(f"{API}/sv/tournaments/{t['id']}/leaderboard",
                      headers=_h(player_tok), timeout=15).json()
    me = next(row for row in lb if row["nickname"].startswith("svp_"))
    assert me["lives_left"] == 2


def test_settle_correct_pick_blocks_signs(admin_tok, player_tok):
    season = f"t-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    t = _make_tournament(admin_tok, season)
    _join(player_tok, t["invite_code"])
    md1 = _current_md(player_tok, t["id"])
    fx1 = md1["fixtures"][0]

    _submit_pick(player_tok, t["id"], md1["id"], fx1["home_team"], fx1["away_team"], "1")
    _settle(admin_tok, t["id"], md1["id"], results=[
        {"home_team": fx1["home_team"], "away_team": fx1["away_team"],
         "home_score": 3, "away_score": 0},
    ])

    r = requests.get(f"{API}/sv/tournaments/{t['id']}/blocked-signs",
                     headers=_h(player_tok), timeout=15).json()
    blocks = r["blocked_signs"]
    teams = {(b["team"], b["outcome"]) for b in blocks}
    assert (fx1["home_team"], "W") in teams
    assert (fx1["away_team"], "L") in teams
    assert r["lives_left"] == 3  # correct pick doesn't cost a life


def test_blocked_sign_prevents_future_pick(admin_tok, player_tok):
    """After correctly guessing HomeA_md1 → W, picking HomeA_md1 → 1
    again on a future matchday must fail — but the calendar uses distinct
    teams per matchday, so we manipulate the calendar to reuse the team."""
    season = f"t-{uuid.uuid4().hex[:4]}"
    # Custom calendar: team X plays home in md1 AND home in md2.
    kickoff = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    fixtures = [
        {"matchday": 1, "home_team": "Alpha", "away_team": "Beta",
         "kickoff_iso": kickoff},
        {"matchday": 2, "home_team": "Alpha", "away_team": "Gamma",
         "kickoff_iso": kickoff},
    ]
    requests.post(f"{API}/sal/calendar/import",
                  json={"season": season, "fixtures": fixtures, "replace": True},
                  headers=_h(admin_tok), timeout=15).raise_for_status()

    t = _make_tournament(admin_tok, season)
    _join(player_tok, t["invite_code"])
    md1 = _current_md(player_tok, t["id"])
    _submit_pick(player_tok, t["id"], md1["id"], "Alpha", "Beta", "1")
    _settle(admin_tok, t["id"], md1["id"], results=[
        {"home_team": "Alpha", "away_team": "Beta", "home_score": 2, "away_score": 0},
    ])

    # Now md2 is current. Attempting Alpha=W again must fail.
    md2 = _current_md(player_tok, t["id"])
    assert md2["matchday"] == 2
    r = _submit_pick(player_tok, t["id"], md2["id"], "Alpha", "Gamma", "1")
    assert r.status_code == 400
    assert "bloccato" in r.text.lower() or "block" in r.text.lower()

    # But picking a draw (X) is still allowed
    r = _submit_pick(player_tok, t["id"], md2["id"], "Alpha", "Gamma", "X")
    assert r.status_code == 200


def test_elimination_at_zero_lives(admin_tok, player_tok):
    season = f"t-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season, matchdays=3)
    t = _make_tournament(admin_tok, season, initial_lives=1)
    _join(player_tok, t["invite_code"])

    md1 = _current_md(player_tok, t["id"])
    fx = md1["fixtures"][0]
    _submit_pick(player_tok, t["id"], md1["id"], fx["home_team"], fx["away_team"], "1")
    # Actual result: home lost → pick wrong → life goes to 0 → eliminated
    _settle(admin_tok, t["id"], md1["id"], results=[
        {"home_team": fx["home_team"], "away_team": fx["away_team"],
         "home_score": 0, "away_score": 3},
    ])

    lb = requests.get(f"{API}/sv/tournaments/{t['id']}/leaderboard",
                      headers=_h(player_tok), timeout=15).json()
    me = next(row for row in lb if row["nickname"].startswith("svp_"))
    assert me["lives_left"] == 0
    assert me["eliminated"] is True


def test_auto_progression_advances_current_matchday(admin_tok, player_tok):
    season = f"t-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season, matchdays=3)
    t = _make_tournament(admin_tok, season)
    _join(player_tok, t["invite_code"])

    md1 = _current_md(player_tok, t["id"])
    fx = md1["fixtures"][0]
    _submit_pick(player_tok, t["id"], md1["id"], fx["home_team"], fx["away_team"], "1")
    res = _settle(admin_tok, t["id"], md1["id"], results=[
        {"home_team": fx["home_team"], "away_team": fx["away_team"],
         "home_score": 1, "away_score": 0},
    ])
    assert res["tournament_finished"] is False
    assert res["next_matchday"] == 2

    # Tournament pointer now on md=2
    detail = requests.get(f"{API}/sv/tournaments/{t['id']}",
                          headers=_h(player_tok), timeout=15).json()
    assert detail["current_matchday"] == 2


def test_history_archive_shows_finished(admin_tok, player_tok):
    """After finishing every matchday the tournament moves to /history."""
    season = f"t-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season, matchdays=1)  # Single matchday season
    t = _make_tournament(admin_tok, season)
    _join(player_tok, t["invite_code"])
    md = _current_md(player_tok, t["id"])
    fx = md["fixtures"][0]
    _submit_pick(player_tok, t["id"], md["id"], fx["home_team"], fx["away_team"], "1")
    res = _settle(admin_tok, t["id"], md["id"], results=[
        {"home_team": fx["home_team"], "away_team": fx["away_team"],
         "home_score": 2, "away_score": 0},
    ])
    assert res["tournament_finished"] is True

    hist = requests.get(f"{API}/sv/tournaments/history",
                        headers=_h(player_tok), timeout=15).json()
    assert any(x["id"] == t["id"] for x in hist)


def test_summary_hides_details_pre_kickoff(admin_tok, player_tok):
    season = f"t-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)  # kickoff far in the future
    t = _make_tournament(admin_tok, season)
    _join(player_tok, t["invite_code"])
    md = _current_md(player_tok, t["id"])
    fx = md["fixtures"][0]
    _submit_pick(player_tok, t["id"], md["id"], fx["home_team"], fx["away_team"], "1")

    r = requests.get(
        f"{API}/sv/tournaments/{t['id']}/matchdays/{md['id']}/summary",
        headers=_h(player_tok), timeout=15,
    ).json()
    assert r["locked"] is False
    # Aggregates present, per-pick list hidden
    for fixture_slot in r["fixtures"]:
        assert "counts" in fixture_slot
        # `picks` must be None (or missing) pre-kickoff
        assert fixture_slot.get("picks") is None


def test_summary_reveals_details_post_kickoff(admin_tok, player_tok):
    """When the calendar has a past kickoff, the summary MUST reveal the
    per-user picks. We seed a matchday whose kickoff is 5 seconds ago."""
    season = f"t-{uuid.uuid4().hex[:4]}"
    past = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    fixtures = [
        {"matchday": 1, "home_team": "Zeta", "away_team": "Eta",
         "kickoff_iso": past},
    ]
    requests.post(f"{API}/sal/calendar/import",
                  json={"season": season, "fixtures": fixtures, "replace": True},
                  headers=_h(admin_tok), timeout=15).raise_for_status()

    t = _make_tournament(admin_tok, season)
    _join(player_tok, t["invite_code"])
    md = _current_md(player_tok, t["id"])
    # Wait for the matchday to actually flip to "locked" (already past kickoff).
    # Kickoff is 5s in the past — no waiting needed.
    # Submitting must FAIL because md is locked.
    r = _submit_pick(player_tok, t["id"], md["id"], "Zeta", "Eta", "1")
    assert r.status_code == 403

    # Read summary — since it's locked, `picks` list is populated (even if empty).
    r = requests.get(
        f"{API}/sv/tournaments/{t['id']}/matchdays/{md['id']}/summary",
        headers=_h(player_tok), timeout=15,
    ).json()
    assert r["locked"] is True
    for fx in r["fixtures"]:
        assert fx.get("picks") is not None  # empty list allowed, but not None


def test_delete_tournament_cascades(admin_tok, player_tok):
    season = f"t-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    t = _make_tournament(admin_tok, season)
    _join(player_tok, t["invite_code"])
    tid = t["id"]

    r = requests.delete(f"{API}/sv/tournaments/{tid}",
                        headers=_h(admin_tok), timeout=15)
    assert r.status_code == 200

    # Now the tournament is gone
    r = requests.get(f"{API}/sv/tournaments/{tid}",
                     headers=_h(admin_tok), timeout=15)
    assert r.status_code == 404
