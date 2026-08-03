"""Tests for the Bonus games module (5th slot) — per-subscription picks.

Every subscription (room / tournament / league) entitles the user to a
SEPARATE bonus pick, and rewards are granted only to the winning subscription.
"""
import os
import uuid
import requests
import pytest
from datetime import datetime, timedelta, timezone

API = os.environ.get("API_BASE_URL", "http://localhost:8001") + "/api"
ADMIN_EMAIL = "verone.salvatore@libero.it"
ADMIN_PASSWORD = "SchedinaBar2026!"


def _h(tok): return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_tok():
    r = requests.post(
        f"{API}/auth/admin/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15,
    )
    r.raise_for_status()
    return r.json()["token"]


def _player():
    r = requests.post(
        f"{API}/auth/player/register",
        json={"username": f"bn_{uuid.uuid4().hex[:5]}", "password": "pw12345678"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["token"], r.json()["user"]["id"]


def _seed_calendar(admin_tok, season):
    fixtures = []
    for md in range(1, 4):
        kickoff = (datetime.now(timezone.utc) + timedelta(days=30 + md)).isoformat()
        for i, (h, a) in enumerate([("Alpha", "Beta"), ("Gamma", "Delta"), ("Epsilon", "Zeta")]):
            fixtures.append({
                "matchday": md,
                "home_team": f"{h}_{md}", "away_team": f"{a}_{md}",
                "kickoff_iso": kickoff,
            })
    requests.post(
        f"{API}/sal/calendar/import",
        json={"season": season, "fixtures": fixtures, "replace": True},
        headers=_h(admin_tok), timeout=15,
    ).raise_for_status()


def _create_survival(admin_tok, season, name=None):
    r = requests.post(
        f"{API}/sv/tournaments",
        json={"name": name or f"BNSV_{uuid.uuid4().hex[:4]}",
              "season": season, "initial_lives": 2},
        headers=_h(admin_tok), timeout=15,
    )
    r.raise_for_status()
    return r.json()


def _sv_new_invite(admin_tok, tid):
    r = requests.post(
        f"{API}/sv/tournaments/{tid}/invites",
        headers=_h(admin_tok), timeout=15,
    )
    r.raise_for_status()
    return r.json()["code"]


def _sv_join(player_tok, code):
    r = requests.post(
        f"{API}/sv/tournaments/join",
        json={"invite_code": code},
        headers=_h(player_tok), timeout=15,
    )
    r.raise_for_status()


def _create_sal(admin_tok, season):
    r = requests.post(
        f"{API}/sal/tournaments",
        json={"name": f"BNSAL_{uuid.uuid4().hex[:4]}", "season": season,
              "initial_lives": 3, "start_matchday": 1},
        headers=_h(admin_tok), timeout=15,
    )
    r.raise_for_status()
    return r.json()


def _sal_join(player_tok, tid, code):
    r = requests.post(
        f"{API}/sal/tournaments/{tid}/join",
        json={"invite_code": code},
        headers=_h(player_tok), timeout=15,
    )
    r.raise_for_status()


def _create_bonus_exact(admin_tok, season, matchday=1):
    r = requests.post(
        f"{API}/bonus/configs",
        json={
            "season": season, "matchday": matchday, "bonus_type": "exact_score",
            "big_match": {"home_team": f"Alpha_{matchday}", "away_team": f"Beta_{matchday}"},
        },
        headers=_h(admin_tok), timeout=15,
    )
    r.raise_for_status()
    return r.json()


def _create_bonus_scorer(admin_tok, season, matchday=1):
    r = requests.post(
        f"{API}/bonus/configs",
        json={"season": season, "matchday": matchday, "bonus_type": "first_scorer"},
        headers=_h(admin_tok), timeout=15,
    )
    r.raise_for_status()
    return r.json()


# =========================================================================
# Eligibility & subscriptions
# =========================================================================

def test_eligibility_returns_subscription_count(admin_tok):
    season = f"bn-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    tok, _ = _player()

    # Fresh player: eligible for nothing
    e = requests.get(f"{API}/bonus/eligibility", headers=_h(tok), timeout=15).json()
    assert e["tiket"] == {"eligible": False, "subscriptions": 0}
    assert e["survival"] == {"eligible": False, "subscriptions": 0}

    # Join TWO Survival tournaments (two different invites → two subs)
    t1 = _create_survival(admin_tok, season, "SVR-A")
    _sv_join(tok, t1["invite_code"])
    t2 = _create_survival(admin_tok, season, "SVR-B")
    _sv_join(tok, t2["invite_code"])

    e = requests.get(f"{API}/bonus/eligibility", headers=_h(tok), timeout=15).json()
    assert e["survival"]["eligible"] is True
    assert e["survival"]["subscriptions"] == 2

    subs = requests.get(
        f"{API}/bonus/subscriptions?game=survival", headers=_h(tok), timeout=15,
    ).json()
    assert len(subs) == 2
    assert {s["id"] for s in subs} == {t1["id"], t2["id"]}


# =========================================================================
# Two subscriptions → two independent picks (Survival)
# =========================================================================

def test_two_survival_subs_get_two_independent_picks(admin_tok):
    season = f"bn-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    tok, uid = _player()

    t1 = _create_survival(admin_tok, season)
    _sv_join(tok, t1["invite_code"])
    t2 = _create_survival(admin_tok, season)
    _sv_join(tok, t2["invite_code"])

    _create_bonus_exact(admin_tok, season)

    # Available returns 2 subscriptions
    av = requests.get(
        f"{API}/bonus/available?game=survival&season={season}",
        headers=_h(tok), timeout=15,
    ).json()
    assert len(av["subscriptions"]) == 2

    # Pick 2-1 for tournament 1
    r1 = requests.post(
        f"{API}/bonus/picks/exact",
        json={"game": "survival", "season": season, "subscription_id": t1["id"],
              "home_score": 2, "away_score": 1},
        headers=_h(tok), timeout=15,
    )
    assert r1.status_code == 200

    # Pick 0-0 for tournament 2 (DIFFERENT prediction)
    r2 = requests.post(
        f"{API}/bonus/picks/exact",
        json={"game": "survival", "season": season, "subscription_id": t2["id"],
              "home_score": 0, "away_score": 0},
        headers=_h(tok), timeout=15,
    )
    assert r2.status_code == 200

    # Verify both picks exist and are independent
    av = requests.get(
        f"{API}/bonus/available?game=survival&season={season}",
        headers=_h(tok), timeout=15,
    ).json()
    picks_by_sub = {s["id"]: s["my_pick"] for s in av["subscriptions"]}
    assert picks_by_sub[t1["id"]]["pick"] == {"home_score": 2, "away_score": 1}
    assert picks_by_sub[t2["id"]]["pick"] == {"home_score": 0, "away_score": 0}


def test_reward_targets_only_winning_subscription(admin_tok):
    """User with 2 SV subs — only the pick tied to the winning sub receives +1 life."""
    season = f"bn-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    tok, uid = _player()

    t1 = _create_survival(admin_tok, season)  # correct pick will go here
    _sv_join(tok, t1["invite_code"])
    t2 = _create_survival(admin_tok, season)  # wrong pick here
    _sv_join(tok, t2["invite_code"])

    cfg = _create_bonus_exact(admin_tok, season)

    # t1: 2-1 (correct), t2: 3-3 (wrong)
    requests.post(f"{API}/bonus/picks/exact", headers=_h(tok), timeout=15,
                  json={"game": "survival", "season": season,
                        "subscription_id": t1["id"], "home_score": 2, "away_score": 1}).raise_for_status()
    requests.post(f"{API}/bonus/picks/exact", headers=_h(tok), timeout=15,
                  json={"game": "survival", "season": season,
                        "subscription_id": t2["id"], "home_score": 3, "away_score": 3}).raise_for_status()

    r = requests.post(
        f"{API}/bonus/configs/{cfg['id']}/settle-exact",
        json={"home_score": 2, "away_score": 1},
        headers=_h(admin_tok), timeout=15,
    ).json()
    assert r["winners"] == 1  # exactly ONE winning pick

    # Verify only t1 got the extra life
    lb1 = requests.get(f"{API}/sv/tournaments/{t1['id']}/leaderboard",
                       headers=_h(tok), timeout=15).json()
    lb2 = requests.get(f"{API}/sv/tournaments/{t2['id']}/leaderboard",
                       headers=_h(tok), timeout=15).json()
    me1 = next(x for x in lb1 if x["user_id"] == uid)
    me2 = next(x for x in lb2 if x["user_id"] == uid)
    # initial_lives=2. t1 wins → 3. t2 does not → still 2.
    assert me1["lives_left"] == 3
    assert me2["lives_left"] == 2


# =========================================================================
# Two Tiket rooms → two credits
# =========================================================================

def test_two_tiket_rooms_produce_two_pending_credits(admin_tok):
    season = f"bn-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    tok, uid = _player()

    # Two rooms with two invites → two subscriptions
    room1 = requests.post(f"{API}/rooms", headers=_h(admin_tok), timeout=15,
                          json={"name": f"R1_{uuid.uuid4().hex[:4]}", "matchday": 1, "max_events": 3}).json()
    room2 = requests.post(f"{API}/rooms", headers=_h(admin_tok), timeout=15,
                          json={"name": f"R2_{uuid.uuid4().hex[:4]}", "matchday": 1, "max_events": 3}).json()
    requests.post(f"{API}/rooms/join", headers=_h(tok), timeout=15,
                  json={"invite_code": room1["invite_code"]}).raise_for_status()
    requests.post(f"{API}/rooms/join", headers=_h(tok), timeout=15,
                  json={"invite_code": room2["invite_code"]}).raise_for_status()

    cfg = _create_bonus_exact(admin_tok, season)

    # Winning pick on room1, losing on room2
    requests.post(f"{API}/bonus/picks/exact", headers=_h(tok), timeout=15,
                  json={"game": "tiket", "season": season,
                        "subscription_id": room1["id"], "home_score": 1, "away_score": 0}).raise_for_status()
    requests.post(f"{API}/bonus/picks/exact", headers=_h(tok), timeout=15,
                  json={"game": "tiket", "season": season,
                        "subscription_id": room2["id"], "home_score": 9, "away_score": 9}).raise_for_status()

    r = requests.post(f"{API}/bonus/configs/{cfg['id']}/settle-exact", headers=_h(admin_tok),
                      json={"home_score": 1, "away_score": 0}, timeout=15).json()
    assert r["winners"] == 1

    hist = requests.get(
        f"{API}/bonus/history?game=tiket&season={season}",
        headers=_h(tok), timeout=15,
    ).json()
    assert len(hist) == 2
    correct = [h for h in hist if h["is_correct"]]
    wrong = [h for h in hist if h["is_correct"] is False]
    assert len(correct) == 1
    assert len(wrong) == 1
    # The winning entry must reference room1 in its reward
    assert correct[0]["reward_details"]["subscription_id"] == room1["id"]


# =========================================================================
# First-scorer bonus with two Score tournaments
# =========================================================================

def test_two_score_tournaments_settle_scorer_targets_each(admin_tok):
    season = f"bn-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    tok, uid = _player()

    t1 = _create_sal(admin_tok, season)
    _sal_join(tok, t1["id"], t1["invite_code"])
    t2 = _create_sal(admin_tok, season)
    _sal_join(tok, t2["id"], t2["invite_code"])

    cfg = _create_bonus_scorer(admin_tok, season)

    # Both picks equal to the correct scorer → both win
    for tid in (t1["id"], t2["id"]):
        requests.post(f"{API}/bonus/picks/scorer", headers=_h(tok), timeout=15,
                      json={"game": "score", "season": season,
                            "subscription_id": tid, "player_name": "Kevin De Bruyne"}).raise_for_status()

    r = requests.post(f"{API}/bonus/configs/{cfg['id']}/settle-scorer", headers=_h(admin_tok),
                      json={"player_name": "kevin de bruyne"}, timeout=15).json()
    assert r["winners"] == 2  # both subscriptions win

    # Each tournament gets +1 life for the player
    for tid in (t1["id"], t2["id"]):
        detail = requests.get(f"{API}/sal/tournaments/{tid}",
                              headers=_h(tok), timeout=15).json()
        me = next(x for x in detail["participants"] if x["user_id"] == uid)
        assert me["lives_remaining"] == 4  # 3 initial + 1 bonus


# =========================================================================
# Guards
# =========================================================================

def test_pick_rejected_for_non_member_subscription(admin_tok):
    season = f"bn-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    tok, _ = _player()

    # Player is NOT joined to this tournament
    ghost = _create_survival(admin_tok, season)
    _create_bonus_exact(admin_tok, season)

    r = requests.post(f"{API}/bonus/picks/exact", headers=_h(tok), timeout=15,
                      json={"game": "survival", "season": season,
                            "subscription_id": ghost["id"], "home_score": 1, "away_score": 1})
    assert r.status_code == 403


def test_two_fanta_leagues_give_two_bonus_picks_and_rewards(admin_tok):
    """Fanta: user in 2 leagues → 2 independent picks + +3 on winning league only."""
    season = f"bn-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    tok, uid = _player()

    # Create 2 Fanta leagues + join both
    l1 = requests.post(f"{API}/fg/leagues", headers=_h(admin_tok), timeout=15,
                       json={"name": f"BNFG1_{uuid.uuid4().hex[:4]}"}).json()
    l2 = requests.post(f"{API}/fg/leagues", headers=_h(admin_tok), timeout=15,
                       json={"name": f"BNFG2_{uuid.uuid4().hex[:4]}"}).json()
    for lg in (l1, l2):
        requests.post(f"{API}/fg/leagues/{lg['id']}/join",
                      headers=_h(tok), timeout=15,
                      json={"invite_code": lg["invite_code"]}).raise_for_status()

    # Subscriptions endpoint returns both
    subs = requests.get(f"{API}/bonus/subscriptions?game=fanta",
                        headers=_h(tok), timeout=15).json()
    assert {s["id"] for s in subs} == {l1["id"], l2["id"]}

    # Create first_scorer bonus
    cfg = _create_bonus_scorer(admin_tok, season)

    # l1 pick is correct, l2 pick is wrong
    requests.post(f"{API}/bonus/picks/scorer", headers=_h(tok), timeout=15,
                  json={"game": "fanta", "season": season,
                        "subscription_id": l1["id"], "player_name": "Rafael Leao"}).raise_for_status()
    requests.post(f"{API}/bonus/picks/scorer", headers=_h(tok), timeout=15,
                  json={"game": "fanta", "season": season,
                        "subscription_id": l2["id"], "player_name": "Wrong Player"}).raise_for_status()

    r = requests.post(f"{API}/bonus/configs/{cfg['id']}/settle-scorer",
                      headers=_h(admin_tok), timeout=15,
                      json={"player_name": "Rafael Leão"}).json()
    assert r["winners"] == 1

    # Check history: 2 picks, 1 correct with league_id=l1, 1 wrong
    hist = requests.get(f"{API}/bonus/history?game=fanta&season={season}",
                       headers=_h(tok), timeout=15).json()
    assert len(hist) == 2
    correct = [h for h in hist if h["is_correct"]]
    assert len(correct) == 1
    assert correct[0]["reward_details"]["subscription_id"] == l1["id"]
    assert correct[0]["reward_details"]["points"] == 3


def test_first_scorer_normalization_case_and_accents(admin_tok):
    season = f"bn-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    tok, _ = _player()
    t = _create_sal(admin_tok, season)
    _sal_join(tok, t["id"], t["invite_code"])
    cfg = _create_bonus_scorer(admin_tok, season)

    requests.post(f"{API}/bonus/picks/scorer", headers=_h(tok), timeout=15,
                  json={"game": "score", "season": season, "subscription_id": t["id"],
                        "player_name": "  LÁUTARO   martinez "}).raise_for_status()
    r = requests.post(f"{API}/bonus/configs/{cfg['id']}/settle-scorer",
                      headers=_h(admin_tok), timeout=15,
                      json={"player_name": "Lautaro Martínez"}).json()
    assert r["winners"] == 1
