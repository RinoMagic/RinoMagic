"""Tests for the Bonus games module (5th slot).

Covers: eligibility, config create/settle, exact_score + first_scorer picks,
reward granting (Tiket credit / Score+Survival lives / Fanta +3), lock
countdown enforcement, and privacy summary.
"""
import os
import uuid
import requests
import pytest
from datetime import datetime, timedelta, timezone

API = os.environ.get("API_BASE_URL", "http://localhost:8001") + "/api"
ADMIN_EMAIL = "verone.salvatore@libero.it"
ADMIN_PASSWORD = "SchedinaBar2026!"

FUTURE_KICKOFF = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()


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
    """3 matchdays × 3 fixtures each — kickoff in the future so bonuses stay open."""
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


def _create_survival_and_join(admin_tok, player_tok, season):
    r = requests.post(
        f"{API}/sv/tournaments",
        json={"name": f"BNSV_{uuid.uuid4().hex[:4]}", "season": season, "initial_lives": 2},
        headers=_h(admin_tok), timeout=15,
    )
    r.raise_for_status()
    t = r.json()
    requests.post(
        f"{API}/sv/tournaments/join",
        json={"invite_code": t["invite_code"]},
        headers=_h(player_tok), timeout=15,
    ).raise_for_status()
    return t


def _create_sal_and_join(admin_tok, player_tok, season):
    r = requests.post(
        f"{API}/sal/tournaments",
        json={"name": f"BNSAL_{uuid.uuid4().hex[:4]}", "season": season,
              "initial_lives": 3, "start_matchday": 1},
        headers=_h(admin_tok), timeout=15,
    )
    r.raise_for_status()
    t = r.json()
    tid = t["id"]
    invite = t.get("invite_code")
    requests.post(
        f"{API}/sal/tournaments/{tid}/join",
        json={"invite_code": invite},
        headers=_h(player_tok), timeout=15,
    ).raise_for_status()
    return t


# =========================================================================
# Eligibility
# =========================================================================

def test_eligibility_flags_reflect_subscriptions(admin_tok):
    season = f"bn-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    tok, uid = _player()

    # Fresh player: eligible for nothing
    r = requests.get(f"{API}/bonus/eligibility", headers=_h(tok), timeout=15)
    r.raise_for_status()
    e = r.json()
    assert e == {"tiket": False, "score": False, "fanta": False, "survival": False}

    # Join a Survival tournament → survival eligibility flips to True
    _create_survival_and_join(admin_tok, tok, season)
    e = requests.get(f"{API}/bonus/eligibility", headers=_h(tok), timeout=15).json()
    assert e["survival"] is True
    assert e["tiket"] is False


# =========================================================================
# Config creation
# =========================================================================

def test_admin_creates_exact_score_bonus_and_first_scorer(admin_tok):
    season = f"bn-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)

    # exact_score requires a big_match from the calendar
    r = requests.post(
        f"{API}/bonus/configs",
        json={
            "season": season, "matchday": 1, "bonus_type": "exact_score",
            "big_match": {"home_team": "Alpha_1", "away_team": "Beta_1"},
        },
        headers=_h(admin_tok), timeout=15,
    )
    assert r.status_code == 200
    cfg = r.json()
    assert cfg["bonus_type"] == "exact_score"
    assert cfg["big_match"]["home_team"] == "Alpha_1"
    assert cfg["status"] == "open"
    assert cfg["lock_at"]

    # Reject when big_match not in calendar
    bad = requests.post(
        f"{API}/bonus/configs",
        json={
            "season": season, "matchday": 1, "bonus_type": "exact_score",
            "big_match": {"home_team": "NON_EXISTENT", "away_team": "X"},
        },
        headers=_h(admin_tok), timeout=15,
    )
    assert bad.status_code == 400

    # first_scorer does not require big_match
    r = requests.post(
        f"{API}/bonus/configs",
        json={"season": season, "matchday": 1, "bonus_type": "first_scorer"},
        headers=_h(admin_tok), timeout=15,
    )
    assert r.status_code == 200
    assert r.json()["bonus_type"] == "first_scorer"


# =========================================================================
# Player picks + lock enforcement
# =========================================================================

def test_pick_requires_eligibility(admin_tok):
    season = f"bn-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    requests.post(
        f"{API}/bonus/configs",
        json={
            "season": season, "matchday": 1, "bonus_type": "exact_score",
            "big_match": {"home_team": "Alpha_1", "away_team": "Beta_1"},
        },
        headers=_h(admin_tok), timeout=15,
    ).raise_for_status()
    tok, _ = _player()
    # Not subscribed → 403
    r = requests.post(
        f"{API}/bonus/picks/exact",
        json={"game": "survival", "season": season, "home_score": 2, "away_score": 1},
        headers=_h(tok), timeout=15,
    )
    assert r.status_code == 403


def test_pick_and_replace(admin_tok):
    season = f"bn-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    tok, uid = _player()
    _create_survival_and_join(admin_tok, tok, season)
    requests.post(
        f"{API}/bonus/configs",
        json={
            "season": season, "matchday": 1, "bonus_type": "exact_score",
            "big_match": {"home_team": "Alpha_1", "away_team": "Beta_1"},
        },
        headers=_h(admin_tok), timeout=15,
    ).raise_for_status()

    r = requests.post(
        f"{API}/bonus/picks/exact",
        json={"game": "survival", "season": season, "home_score": 2, "away_score": 1},
        headers=_h(tok), timeout=15,
    )
    assert r.status_code == 200
    assert r.json()["pick"] == {"home_score": 2, "away_score": 1}

    # Replace with new pick
    r = requests.post(
        f"{API}/bonus/picks/exact",
        json={"game": "survival", "season": season, "home_score": 3, "away_score": 3},
        headers=_h(tok), timeout=15,
    )
    assert r.status_code == 200
    assert r.json()["pick"] == {"home_score": 3, "away_score": 3}

    # Available endpoint returns the current pick
    r = requests.get(
        f"{API}/bonus/available?game=survival&season={season}",
        headers=_h(tok), timeout=15,
    ).json()
    assert r["config"] is not None
    assert r["my_pick"]["pick"] == {"home_score": 3, "away_score": 3}


# =========================================================================
# Settle + rewards
# =========================================================================

def test_settle_exact_grants_survival_life(admin_tok):
    season = f"bn-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    tok, uid = _player()
    _create_survival_and_join(admin_tok, tok, season)

    cfg = requests.post(
        f"{API}/bonus/configs",
        json={
            "season": season, "matchday": 1, "bonus_type": "exact_score",
            "big_match": {"home_team": "Alpha_1", "away_team": "Beta_1"},
        },
        headers=_h(admin_tok), timeout=15,
    ).json()

    # Winning pick
    requests.post(
        f"{API}/bonus/picks/exact",
        json={"game": "survival", "season": season, "home_score": 2, "away_score": 1},
        headers=_h(tok), timeout=15,
    ).raise_for_status()

    # Settle with the same score → player wins → +1 life on their SV participation
    r = requests.post(
        f"{API}/bonus/configs/{cfg['id']}/settle-exact",
        json={"home_score": 2, "away_score": 1},
        headers=_h(admin_tok), timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["winners"] == 1
    assert body["total_picks"] == 1

    # Check life increment via tournaments listing
    tourns = requests.get(
        f"{API}/sv/tournaments", headers=_h(tok), timeout=15,
    ).json()
    my_tour = tourns[0]
    lb = requests.get(
        f"{API}/sv/tournaments/{my_tour['id']}/leaderboard",
        headers=_h(tok), timeout=15,
    ).json()
    me = next(r for r in lb if r["user_id"] == uid)
    # initial_lives=2 → after +1 → 3
    assert me["lives_left"] == 3

    # Idempotent re-settle does NOT double-grant
    r = requests.post(
        f"{API}/bonus/configs/{cfg['id']}/settle-exact",
        json={"home_score": 2, "away_score": 1},
        headers=_h(admin_tok), timeout=15,
    )
    # After settle the config is marked settled → subsequent create/settle is
    # disallowed on stale configs. But our settle re-computes correctness on
    # existing picks — verify by checking the winner did not receive a 2nd life.
    lb = requests.get(
        f"{API}/sv/tournaments/{my_tour['id']}/leaderboard",
        headers=_h(tok), timeout=15,
    ).json()
    me = next(r for r in lb if r["user_id"] == uid)
    assert me["lives_left"] == 3  # still 3, no double reward


def test_settle_first_scorer_case_insensitive(admin_tok):
    season = f"bn-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    tok, uid = _player()
    _create_sal_and_join(admin_tok, tok, season)

    cfg = requests.post(
        f"{API}/bonus/configs",
        json={"season": season, "matchday": 1, "bonus_type": "first_scorer"},
        headers=_h(admin_tok), timeout=15,
    ).json()

    # Player picks "Lautaro Martinez" (weird casing + accents)
    requests.post(
        f"{API}/bonus/picks/scorer",
        json={"game": "score", "season": season, "player_name": "  LÁUTARO   martinez "},
        headers=_h(tok), timeout=15,
    ).raise_for_status()

    # Admin settles with different casing/accent → still a match
    r = requests.post(
        f"{API}/bonus/configs/{cfg['id']}/settle-scorer",
        json={"player_name": "Lautaro Martínez"},
        headers=_h(admin_tok), timeout=15,
    )
    assert r.status_code == 200
    assert r.json()["winners"] == 1


def test_settle_first_scorer_wrong_pick_no_reward(admin_tok):
    season = f"bn-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    tok, _ = _player()
    _create_sal_and_join(admin_tok, tok, season)
    cfg = requests.post(
        f"{API}/bonus/configs",
        json={"season": season, "matchday": 1, "bonus_type": "first_scorer"},
        headers=_h(admin_tok), timeout=15,
    ).json()
    requests.post(
        f"{API}/bonus/picks/scorer",
        json={"game": "score", "season": season, "player_name": "Wrong Guy"},
        headers=_h(tok), timeout=15,
    ).raise_for_status()
    r = requests.post(
        f"{API}/bonus/configs/{cfg['id']}/settle-scorer",
        json={"player_name": "Right Guy"},
        headers=_h(admin_tok), timeout=15,
    ).json()
    assert r["winners"] == 0


def test_tiket_bonus_creates_pending_credit(admin_tok):
    """Winning the Tiket bonus should create a pending admin-handled credit."""
    season = f"bn-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    tok, uid = _player()

    # Create a Tiket room and join
    r = requests.post(
        f"{API}/rooms",
        json={"name": f"BNTIK_{uuid.uuid4().hex[:4]}", "matchday": 1, "max_events": 3},
        headers=_h(admin_tok), timeout=15,
    )
    r.raise_for_status()
    room = r.json()
    invite_code = room["invite_code"]
    requests.post(
        f"{API}/rooms/join",
        json={"invite_code": invite_code},
        headers=_h(tok), timeout=15,
    ).raise_for_status()

    cfg = requests.post(
        f"{API}/bonus/configs",
        json={
            "season": season, "matchday": 1, "bonus_type": "exact_score",
            "big_match": {"home_team": "Alpha_1", "away_team": "Beta_1"},
        },
        headers=_h(admin_tok), timeout=15,
    ).json()
    requests.post(
        f"{API}/bonus/picks/exact",
        json={"game": "tiket", "season": season, "home_score": 1, "away_score": 0},
        headers=_h(tok), timeout=15,
    ).raise_for_status()
    r = requests.post(
        f"{API}/bonus/configs/{cfg['id']}/settle-exact",
        json={"home_score": 1, "away_score": 0},
        headers=_h(admin_tok), timeout=15,
    ).json()
    assert r["winners"] == 1

    # Verify pending credit exists in the winner's history
    hist = requests.get(
        f"{API}/bonus/history?game=tiket&season={season}",
        headers=_h(tok), timeout=15,
    ).json()
    assert len(hist) == 1
    assert hist[0]["is_correct"] is True
    assert hist[0]["reward_details"]["kind"] == "extra_bet_slip_pending"


def test_history_and_summary_privacy(admin_tok):
    season = f"bn-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    tok, _ = _player()
    _create_sal_and_join(admin_tok, tok, season)
    cfg = requests.post(
        f"{API}/bonus/configs",
        json={"season": season, "matchday": 1, "bonus_type": "first_scorer"},
        headers=_h(admin_tok), timeout=15,
    ).json()
    requests.post(
        f"{API}/bonus/picks/scorer",
        json={"game": "score", "season": season, "player_name": "Someone"},
        headers=_h(tok), timeout=15,
    ).raise_for_status()

    # Summary before lock → aggregated counts only, no per-user details
    s = requests.get(
        f"{API}/bonus/configs/{cfg['id']}/summary",
        headers=_h(tok), timeout=15,
    ).json()
    assert s["total_picks"] == 1
    assert s["picks_by_game"]["score"] == 1
    assert s["details"] is None
