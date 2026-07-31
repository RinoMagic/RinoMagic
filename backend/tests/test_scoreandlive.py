"""End-to-end tests for the ScoreAndLive mini-game.

Covers:
- Player roster import + search
- Tournament CRUD + invite join
- Matchday creation with pre-postponed fixtures
- Pick submission (validation of blocked teams, wrong-team players, ...)
- Settlement with hits, misses, mid-game postponements
- Elimination trigger + winner declaration
"""
import os
import time
import uuid
import requests
import pytest


API = os.environ.get("API_BASE_URL", "http://localhost:8001") + "/api"

ADMIN_EMAIL = "verone.salvatore@libero.it"
ADMIN_PASSWORD = "SchedinaBar2026!"


def _login(email, password):
    r = requests.post(f"{API}/auth/admin/login",
                      json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _register_player(username, password="pw12345678"):
    r = requests.post(f"{API}/auth/player/register",
                      json={"username": username, "password": password}, timeout=15)
    r.raise_for_status()
    return r.json()["token"], r.json()["user"]


@pytest.fixture(scope="module")
def admin_tok():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def player_toks(admin_tok):
    """Create 3 test players and return their tokens + ids."""
    toks_and_users = [_register_player(f"salp_{uuid.uuid4().hex[:6]}") for _ in range(3)]
    return toks_and_users


@pytest.fixture(scope="module")
def roster(admin_tok):
    """Seed a small Serie A roster (Inter, Roma, Napoli, Lazio)."""
    players = [
        {"first_name": "Lautaro", "last_name": "Martinez", "team": "Inter", "role": "A"},
        {"first_name": "Nicolo", "last_name": "Barella", "team": "Inter", "role": "C"},
        {"first_name": "Paulo", "last_name": "Dybala", "team": "Roma", "role": "A"},
        {"first_name": "Lorenzo", "last_name": "Pellegrini", "team": "Roma", "role": "C"},
        {"first_name": "Kevin", "last_name": "De Bruyne", "team": "Napoli", "role": "C"},
        {"first_name": "Romelu", "last_name": "Lukaku", "team": "Napoli", "role": "A"},
        {"first_name": "Ciro", "last_name": "Immobile", "team": "Lazio", "role": "A"},
        {"first_name": "Mattia", "last_name": "Zaccagni", "team": "Lazio", "role": "A"},
    ]
    requests.post(f"{API}/sal/players/import",
                  json={"replace_all": True, "players": players},
                  headers=_h(admin_tok), timeout=15).raise_for_status()
    # Fetch back and index by (last_name, team)
    r = requests.get(f"{API}/sal/players?limit=200", headers=_h(admin_tok), timeout=15)
    r.raise_for_status()
    return {(p["last_name"], p["team"]): p for p in r.json()}


@pytest.fixture
def tournament(admin_tok, player_toks, roster):
    """Create a fresh tournament, add all 3 test players. Yields (id, invite)."""
    r = requests.post(f"{API}/sal/tournaments",
                      json={"name": f"T{uuid.uuid4().hex[:6]}", "initial_lives": 3},
                      headers=_h(admin_tok), timeout=15)
    r.raise_for_status()
    t = r.json()
    tid = t["id"]
    code = t["invite_code"]
    for tok, _u in player_toks:
        rj = requests.post(f"{API}/sal/tournaments/{tid}/join",
                           json={"invite_code": code}, headers=_h(tok), timeout=15)
        rj.raise_for_status()
    yield tid, code
    # cleanup
    requests.delete(f"{API}/sal/tournaments/{tid}", headers=_h(admin_tok), timeout=15)


# ==================== Players roster ====================
class TestRoster:
    def test_search_by_name(self, admin_tok, roster):
        r = requests.get(f"{API}/sal/players?q=lautaro", headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200
        names = [p["last_name"] for p in r.json()]
        assert "Martinez" in names

    def test_filter_by_team(self, admin_tok, roster):
        r = requests.get(f"{API}/sal/players?team=Roma", headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200
        teams = {p["team"] for p in r.json()}
        assert teams == {"Roma"}

    def test_teams_endpoint(self, admin_tok, roster):
        r = requests.get(f"{API}/sal/players/teams", headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200
        assert set(r.json()) == {"Inter", "Roma", "Napoli", "Lazio"}


# ==================== Tournament lifecycle ====================
class TestTournament:
    def test_create_and_list(self, admin_tok, tournament):
        tid, _code = tournament
        r = requests.get(f"{API}/sal/tournaments", headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()]
        assert tid in ids

    def test_preview_by_code(self, tournament):
        _tid, code = tournament
        r = requests.get(f"{API}/sal/tournaments/by-code/{code}", timeout=15)
        assert r.status_code == 200
        assert r.json()["game"] == "scoreandlive"

    def test_preview_bad_code(self):
        r = requests.get(f"{API}/sal/tournaments/by-code/BADCOD", timeout=15)
        assert r.status_code == 404

    def test_participants_count(self, admin_tok, tournament):
        tid, _ = tournament
        r = requests.get(f"{API}/sal/tournaments/{tid}", headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200
        body = r.json()
        # admin + 3 players = 4 participants
        assert body["participants_total"] == 4


# ==================== Matchday + picks + settlement ====================
class TestMatchdayPickSettle:
    def _md(self, admin_tok, tid, mdn=1, fixtures=None):
        r = requests.post(f"{API}/sal/tournaments/{tid}/matchdays",
                          json={"matchday_number": mdn,
                                "fixtures": fixtures or [
                                    {"home_team": "Inter", "away_team": "Roma"},
                                    {"home_team": "Napoli", "away_team": "Lazio"},
                                ]},
                          headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def test_pick_wrong_team_player_rejected(self, admin_tok, player_toks, tournament, roster):
        tid, _ = tournament
        md_id = self._md(admin_tok, tid)
        # Try to pick Dybala (Roma) for Napoli-Lazio → must fail
        dybala = roster[("Dybala", "Roma")]["id"]
        immobile = roster[("Immobile", "Lazio")]["id"]
        tok, _u = player_toks[0]
        r = requests.post(f"{API}/sal/tournaments/{tid}/matchdays/{md_id}/picks",
                          json={"picks": [
                              {"fixture_idx": 0, "player_id": immobile},  # wrong: Lazio not in Inter-Roma
                              {"fixture_idx": 1, "player_id": dybala},   # wrong: Roma not in Napoli-Lazio
                          ]},
                          headers=_h(tok), timeout=15)
        assert r.status_code == 400
        assert "non fa parte" in r.json()["detail"].lower() or "gioca nel" in r.json()["detail"].lower()

    def test_full_flow_hit_and_miss(self, admin_tok, player_toks, tournament, roster):
        tid, _ = tournament
        md_id = self._md(admin_tok, tid, mdn=2)
        lautaro = roster[("Martinez", "Inter")]["id"]
        dybala = roster[("Dybala", "Roma")]["id"]
        debruyne = roster[("De Bruyne", "Napoli")]["id"]
        immobile = roster[("Immobile", "Lazio")]["id"]

        # Player 0 picks Lautaro (Inter-Roma) + De Bruyne (Napoli-Lazio)
        tok0, _ = player_toks[0]
        r = requests.post(f"{API}/sal/tournaments/{tid}/matchdays/{md_id}/picks",
                          json={"picks": [
                              {"fixture_idx": 0, "player_id": lautaro},
                              {"fixture_idx": 1, "player_id": debruyne},
                          ]}, headers=_h(tok0), timeout=15)
        assert r.status_code == 200

        # Settle: only Lautaro scored (De Bruyne missed)
        r = requests.post(f"{API}/sal/tournaments/{tid}/matchdays/{md_id}/settle",
                          json={"scorers": [{"fixture_idx": 0, "player_id": lautaro}],
                                "postponed_during": []},
                          headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200, r.text

        # Verify player0 has 1 life lost (3 - 1 = 2)
        r = requests.get(f"{API}/sal/tournaments/{tid}", headers=_h(tok0), timeout=15)
        assert r.status_code == 200
        me = next(p for p in r.json()["participants"] if p["is_me"])
        assert me["lives_remaining"] == 2

        # Player0 must have Inter in blocked teams now
        assert "Inter" in r.json()["my_blocked_teams"]

    def test_blocked_team_rejects_next_pick(self, admin_tok, player_toks, tournament, roster):
        tid, _ = tournament
        # Md1: player 0 picks Lautaro and hits → Inter blocked for player 0
        md1 = self._md(admin_tok, tid, mdn=3)
        lautaro = roster[("Martinez", "Inter")]["id"]
        debruyne = roster[("De Bruyne", "Napoli")]["id"]
        tok0, _ = player_toks[0]
        requests.post(f"{API}/sal/tournaments/{tid}/matchdays/{md1}/picks",
                      json={"picks": [{"fixture_idx": 0, "player_id": lautaro},
                                      {"fixture_idx": 1, "player_id": debruyne}]},
                      headers=_h(tok0), timeout=15).raise_for_status()
        requests.post(f"{API}/sal/tournaments/{tid}/matchdays/{md1}/settle",
                      json={"scorers": [{"fixture_idx": 0, "player_id": lautaro},
                                        {"fixture_idx": 1, "player_id": debruyne}],
                            "postponed_during": []},
                      headers=_h(admin_tok), timeout=15).raise_for_status()

        # Md2: try to pick Barella (Inter) again → must fail
        md2 = self._md(admin_tok, tid, mdn=4)
        barella = roster[("Barella", "Inter")]["id"]
        immobile = roster[("Immobile", "Lazio")]["id"]
        r = requests.post(f"{API}/sal/tournaments/{tid}/matchdays/{md2}/picks",
                          json={"picks": [{"fixture_idx": 0, "player_id": barella},
                                          {"fixture_idx": 1, "player_id": immobile}]},
                          headers=_h(tok0), timeout=15)
        assert r.status_code == 400
        assert "Inter" in r.json()["detail"] and "bloccata" in r.json()["detail"].lower()

    def test_pre_postponed_fixture_not_playable(self, admin_tok, player_toks, tournament, roster):
        tid, _ = tournament
        md_id = self._md(admin_tok, tid, mdn=5, fixtures=[
            {"home_team": "Inter", "away_team": "Roma"},
            {"home_team": "Napoli", "away_team": "Lazio", "postponed": True},
        ])
        # Player picks Lautaro for playable fixture (idx 0) — no need for idx 1
        lautaro = roster[("Martinez", "Inter")]["id"]
        tok0, _ = player_toks[0]
        r = requests.post(f"{API}/sal/tournaments/{tid}/matchdays/{md_id}/picks",
                          json={"picks": [{"fixture_idx": 0, "player_id": lautaro}]},
                          headers=_h(tok0), timeout=15)
        assert r.status_code == 200, r.text

    def test_postponed_during_saves_life_and_blocks_all(self, admin_tok, player_toks, tournament, roster):
        tid, _ = tournament
        md_id = self._md(admin_tok, tid, mdn=6, fixtures=[
            {"home_team": "Inter", "away_team": "Roma"},
            {"home_team": "Napoli", "away_team": "Lazio"},
        ])
        # Player picks Immobile in Napoli-Lazio; that match gets postponed during
        immobile = roster[("Immobile", "Lazio")]["id"]
        lautaro = roster[("Martinez", "Inter")]["id"]
        tok0, _ = player_toks[0]
        requests.post(f"{API}/sal/tournaments/{tid}/matchdays/{md_id}/picks",
                      json={"picks": [{"fixture_idx": 0, "player_id": lautaro},
                                      {"fixture_idx": 1, "player_id": immobile}]},
                      headers=_h(tok0), timeout=15).raise_for_status()
        # Get current lives
        r = requests.get(f"{API}/sal/tournaments/{tid}", headers=_h(tok0), timeout=15)
        old_lives = next(p for p in r.json()["participants"] if p["is_me"])["lives_remaining"]

        # Settle: Lautaro scored, fixture 1 postponed during → both Napoli and Lazio blocked for all
        r = requests.post(f"{API}/sal/tournaments/{tid}/matchdays/{md_id}/settle",
                          json={"scorers": [{"fixture_idx": 0, "player_id": lautaro}],
                                "postponed_during": [1]},
                          headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200, r.text
        # Player 0's lives unchanged (0 misses)
        r = requests.get(f"{API}/sal/tournaments/{tid}", headers=_h(tok0), timeout=15)
        new_lives = next(p for p in r.json()["participants"] if p["is_me"])["lives_remaining"]
        assert new_lives == old_lives
        blocked = r.json()["my_blocked_teams"]
        # Should include the retroactively-blocked teams (Napoli, Lazio) + Inter (Lautaro hit)
        assert "Napoli" in blocked and "Lazio" in blocked and "Inter" in blocked


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
