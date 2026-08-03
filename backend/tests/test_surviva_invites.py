"""Tests for Survival 2.0 single-use invite management (admin only).

Mirrors ScoreAndLive's ``test_one_shot_invites`` behaviour.
"""
import os
import uuid
import requests
import pytest

API = os.environ.get("API_BASE_URL", "http://localhost:8001") + "/api"
ADMIN_EMAIL = "verone.salvatore@libero.it"
ADMIN_PASSWORD = "SchedinaBar2026!"


def _h(tok):
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
        json={"username": f"svi_{uuid.uuid4().hex[:4]}", "password": "pw12345678"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["token"]


def _seed_calendar(admin_tok, season):
    requests.post(
        f"{API}/sal/calendar/import",
        json={
            "season": season,
            "fixtures": [
                {"matchday": 1, "home_team": "Alpha", "away_team": "Beta",
                 "kickoff_iso": "2099-01-01T20:00:00+00:00"},
            ],
            "replace": True,
        },
        headers=_h(admin_tok), timeout=15,
    ).raise_for_status()


def _make(admin_tok, season):
    r = requests.post(
        f"{API}/sv/tournaments",
        json={"name": f"INV_{uuid.uuid4().hex[:5]}", "season": season, "initial_lives": 2},
        headers=_h(admin_tok), timeout=15,
    )
    r.raise_for_status()
    return r.json()


def test_admin_generates_invite_and_lists(admin_tok):
    season = f"inv-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    t = _make(admin_tok, season)
    tid = t["id"]

    # At creation there is exactly 1 initial invite
    r = requests.get(
        f"{API}/sv/tournaments/{tid}/invites",
        headers=_h(admin_tok), timeout=15,
    )
    r.raise_for_status()
    assert len(r.json()) == 1

    # Generate 2 more
    r1 = requests.post(
        f"{API}/sv/tournaments/{tid}/invites",
        headers=_h(admin_tok), timeout=15,
    )
    r2 = requests.post(
        f"{API}/sv/tournaments/{tid}/invites",
        headers=_h(admin_tok), timeout=15,
    )
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["code"] != r2.json()["code"]

    r = requests.get(
        f"{API}/sv/tournaments/{tid}/invites",
        headers=_h(admin_tok), timeout=15,
    )
    codes = [i["code"] for i in r.json()]
    assert len(codes) == 3
    assert len(set(codes)) == 3  # all unique


def test_invite_valid_for_only_one_player(admin_tok):
    season = f"inv-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    t = _make(admin_tok, season)
    tid = t["id"]

    # Create a fresh invite
    inv = requests.post(
        f"{API}/sv/tournaments/{tid}/invites",
        headers=_h(admin_tok), timeout=15,
    ).json()
    code = inv["code"]

    # Player 1 joins successfully
    p1 = requests.post(
        f"{API}/auth/player/register",
        json={"username": f"svi_a_{uuid.uuid4().hex[:4]}", "password": "pw12345678"},
        timeout=15,
    ).json()["token"]
    r = requests.post(
        f"{API}/sv/tournaments/join",
        json={"invite_code": code}, headers=_h(p1), timeout=15,
    )
    assert r.status_code == 200

    # Player 2 tries the same code → rejected (already used)
    p2 = requests.post(
        f"{API}/auth/player/register",
        json={"username": f"svi_b_{uuid.uuid4().hex[:4]}", "password": "pw12345678"},
        timeout=15,
    ).json()["token"]
    r = requests.post(
        f"{API}/sv/tournaments/join",
        json={"invite_code": code}, headers=_h(p2), timeout=15,
    )
    assert r.status_code == 410


def test_revoke_unused_invite(admin_tok):
    season = f"inv-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    t = _make(admin_tok, season)
    tid = t["id"]

    inv = requests.post(
        f"{API}/sv/tournaments/{tid}/invites",
        headers=_h(admin_tok), timeout=15,
    ).json()
    inv_id = inv["id"]

    # Revoke it
    r = requests.delete(
        f"{API}/sv/tournaments/{tid}/invites/{inv_id}",
        headers=_h(admin_tok), timeout=15,
    )
    assert r.status_code == 200
    assert r.json()["revoked_at"] is not None

    # Player cannot use it
    p = requests.post(
        f"{API}/auth/player/register",
        json={"username": f"svi_c_{uuid.uuid4().hex[:4]}", "password": "pw12345678"},
        timeout=15,
    ).json()["token"]
    r = requests.post(
        f"{API}/sv/tournaments/join",
        json={"invite_code": inv["code"]}, headers=_h(p), timeout=15,
    )
    assert r.status_code == 410


def test_player_cannot_create_or_list_invites(admin_tok, player_tok):
    season = f"inv-{uuid.uuid4().hex[:4]}"
    _seed_calendar(admin_tok, season)
    t = _make(admin_tok, season)
    tid = t["id"]

    r = requests.get(
        f"{API}/sv/tournaments/{tid}/invites",
        headers=_h(player_tok), timeout=15,
    )
    assert r.status_code == 403

    r = requests.post(
        f"{API}/sv/tournaments/{tid}/invites",
        headers=_h(player_tok), timeout=15,
    )
    assert r.status_code == 403
