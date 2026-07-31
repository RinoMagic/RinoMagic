"""
Comprehensive backend tests for FantaGiornata API.
NOTE: pytest-xdist uses loadscope; tests that share state MUST live in the same class/module.
So all league→lineup→vote→result tests are in TestLeagueFullFlow to stay on same worker.
"""
import pytest
import requests
from conftest import API, auth_headers, _register, _login, ADMIN_EMAIL, ADMIN_PASSWORD


# ---------------- Health & Auth ----------------
class TestHealthAndAuth:
    def test_root(self, session):
        r = session.get(f"{API}/")
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_register_duplicate_email_returns_409(self, session, user1):
        r = _register(session, user1["email"], "Passw0rd!", "otherusername")
        assert r.status_code == 409, f"expected 409 got {r.status_code} {r.text}"

    def test_login_admin(self, session):
        r = _login(session, ADMIN_EMAIL, ADMIN_PASSWORD)
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_login_new_user(self, session, user1):
        r = _login(session, user1["email"], user1["password"])
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_login_wrong_password(self, session, user1):
        r = _login(session, user1["email"], "wrong-password!")
        assert r.status_code == 401

    def test_me_with_valid_token(self, session, user1):
        r = session.get(f"{API}/auth/me", headers=auth_headers(user1["token"]))
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == user1["email"]
        assert data["username"] == user1["username"]
        assert "id" in data

    def test_me_missing_token(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_invalid_token(self):
        r = requests.get(f"{API}/auth/me", headers={"Authorization": "Bearer invalid.token.here"})
        assert r.status_code == 401


# ---------------- Players & Teams ----------------
class TestPlayersAndTeams:
    def test_teams_returns_20(self, session, admin_token):
        r = session.get(f"{API}/teams", headers=auth_headers(admin_token))
        assert r.status_code == 200
        teams = r.json()
        assert isinstance(teams, list)
        assert len(teams) == 20
        assert "Inter" in teams

    def test_players_list_count(self, session, admin_token):
        r = session.get(f"{API}/players", headers=auth_headers(admin_token))
        assert r.status_code == 200
        players = r.json()
        assert len(players) >= 200, f"expected >=200 got {len(players)}"
        p = players[0]
        assert set(["id", "name", "team", "role"]).issubset(p.keys())

    def test_players_filter_role_p(self, session, admin_token):
        r = session.get(f"{API}/players?role=P", headers=auth_headers(admin_token))
        assert r.status_code == 200
        players = r.json()
        assert len(players) >= 20
        assert all(p["role"] == "P" for p in players)

    def test_players_filter_role_a(self, session, admin_token):
        r = session.get(f"{API}/players?role=A", headers=auth_headers(admin_token))
        assert r.status_code == 200
        players = r.json()
        assert len(players) > 0
        assert all(p["role"] == "A" for p in players)

    def test_players_filter_team_inter(self, session, admin_token):
        r = session.get(f"{API}/players?team=Inter", headers=auth_headers(admin_token))
        assert r.status_code == 200
        players = r.json()
        assert len(players) >= 10
        assert all(p["team"] == "Inter" for p in players)

    def test_players_filter_q_lautaro(self, session, admin_token):
        r = session.get(f"{API}/players?q=Lautaro", headers=auth_headers(admin_token))
        assert r.status_code == 200
        players = r.json()
        assert any("Lautaro" in p["name"] for p in players)

    def test_players_requires_auth(self, session):
        r = session.get(f"{API}/players", headers={"Authorization": ""})
        assert r.status_code == 401


# ---------------- Full flow (must run sequentially on same worker) ----------------
class TestLeagueFullFlow:
    """All league/lineup/vote/result/leaderboard/history tests share state.
    Ordered explicitly to guarantee sequence within the class."""

    def test_01_create_league(self, session, user1, request):
        r = session.post(f"{API}/leagues", json={"name": "TEST_Lega Test"}, headers=auth_headers(user1["token"]))
        assert r.status_code == 200
        league = r.json()
        assert len(league["code"]) == 6
        assert league["is_owner"] is True
        assert league["members_count"] == 1
        assert league["current_matchday"] == 1
        # Stash in module-level dict for later tests
        _STATE["league"] = league

    def test_02_join_league_user2(self, session, user2):
        league = _STATE["league"]
        r = session.post(f"{API}/leagues/join", json={"code": league["code"]}, headers=auth_headers(user2["token"]))
        assert r.status_code == 200
        joined = r.json()
        assert joined["id"] == league["id"]
        assert joined["is_owner"] is False
        assert joined["members_count"] >= 2

    def test_03_join_wrong_code(self, session, user2):
        r = session.post(f"{API}/leagues/join", json={"code": "NOEXST"}, headers=auth_headers(user2["token"]))
        assert r.status_code == 404

    def test_04_list_leagues_user1(self, session, user1):
        league = _STATE["league"]
        r = session.get(f"{API}/leagues", headers=auth_headers(user1["token"]))
        assert r.status_code == 200
        found = [x for x in r.json() if x["id"] == league["id"]]
        assert len(found) == 1
        assert found[0]["is_owner"] is True

    def test_05_list_leagues_user2(self, session, user2):
        league = _STATE["league"]
        r = session.get(f"{API}/leagues", headers=auth_headers(user2["token"]))
        assert r.status_code == 200
        found = [x for x in r.json() if x["id"] == league["id"]]
        assert len(found) == 1
        assert found[0]["is_owner"] is False

    def test_06_get_league_members(self, session, user1, user2):
        league = _STATE["league"]
        for u in [user1, user2]:
            r = session.get(f"{API}/leagues/{league['id']}", headers=auth_headers(u["token"]))
            assert r.status_code == 200
            assert r.json()["id"] == league["id"]

    def test_07_get_league_non_member_403(self, session, user3):
        league = _STATE["league"]
        r = session.get(f"{API}/leagues/{league['id']}", headers=auth_headers(user3["token"]))
        assert r.status_code == 403

    def test_08_fetch_player_ids(self, session, admin_token):
        r = session.get(f"{API}/players", headers=auth_headers(admin_token))
        assert r.status_code == 200
        _STATE["players"] = r.json()
        _STATE["players_by_id"] = {p["id"]: p for p in r.json()}
        _STATE["player_ids"] = [p["id"] for p in r.json()]

    def test_09_submit_lineup_user1(self, session, user1):
        league = _STATE["league"]
        starters = _STATE["player_ids"][0:11]
        # Use empty bench (backward compat) - full bench composition tested in test_bench_and_subs.py
        r = session.post(
            f"{API}/leagues/{league['id']}/lineups",
            json={"matchday": 1, "module": "4-3-3", "starters": starters, "bench": []},
            headers=auth_headers(user1["token"]),
        )
        assert r.status_code == 200
        g = session.get(f"{API}/leagues/{league['id']}/lineups/1", headers=auth_headers(user1["token"]))
        assert g.status_code == 200
        assert g.json().get("starters") == starters

    def test_10_submit_lineup_user2(self, session, user2):
        league = _STATE["league"]
        starters = _STATE["player_ids"][15:26]
        r = session.post(
            f"{API}/leagues/{league['id']}/lineups",
            json={"matchday": 1, "module": "3-5-2", "starters": starters, "bench": []},
            headers=auth_headers(user2["token"]),
        )
        assert r.status_code == 200

    def test_11_lineup_10_players_fails(self, session, user1):
        league = _STATE["league"]
        r = session.post(
            f"{API}/leagues/{league['id']}/lineups",
            json={"matchday": 2, "module": "4-3-3", "starters": _STATE["player_ids"][:10], "bench": []},
            headers=auth_headers(user1["token"]),
        )
        assert r.status_code == 400

    def test_12_lineup_duplicates_fails(self, session, user1):
        league = _STATE["league"]
        dupes = _STATE["player_ids"][:10] + [_STATE["player_ids"][0]]
        r = session.post(
            f"{API}/leagues/{league['id']}/lineups",
            json={"matchday": 2, "module": "4-3-3", "starters": dupes, "bench": []},
            headers=auth_headers(user1["token"]),
        )
        assert r.status_code == 400

    def test_13_lineup_invalid_ids_fails(self, session, user1):
        league = _STATE["league"]
        starters = _STATE["player_ids"][:10] + ["nonexistent-player-id"]
        r = session.post(
            f"{API}/leagues/{league['id']}/lineups",
            json={"matchday": 2, "module": "4-3-3", "starters": starters, "bench": []},
            headers=auth_headers(user1["token"]),
        )
        assert r.status_code == 400

    def test_14_non_owner_cannot_submit_votes(self, session, user2):
        league = _STATE["league"]
        r = session.post(
            f"{API}/leagues/{league['id']}/votes",
            json={"matchday": 1, "votes": [{"player_id": _STATE["player_ids"][0], "voto": 7}]},
            headers=auth_headers(user2["token"]),
        )
        assert r.status_code == 403

    def test_15_owner_submits_votes_and_formula(self, session, user1):
        league = _STATE["league"]
        used_ids = _STATE["player_ids"][0:26]
        pbi = _STATE["players_by_id"]
        votes = []
        for i, pid in enumerate(used_ids):
            votes.append({
                "player_id": pid,
                "voto": 6.0 + (i % 3),
                "gol": 1 if i % 5 == 0 else 0,
                "assist": 1 if i % 7 == 0 else 0,
                "ammoniz": (i % 4 == 0),
                "espuls": False,
                "autogol": 0,
                "gol_subiti": 2 if pbi.get(pid, {}).get("role") == "P" else 0,
                "rigore_segnato": 0,
                "rigore_sbagliato": 0,
            })
        r = session.post(
            f"{API}/leagues/{league['id']}/votes",
            json={"matchday": 1, "votes": votes},
            headers=auth_headers(user1["token"]),
        )
        assert r.status_code == 200
        assert r.json().get("count") == len(votes)

        g = session.get(f"{API}/leagues/{league['id']}/votes/1", headers=auth_headers(user1["token"]))
        assert g.status_code == 200
        rows = g.json()
        assert len(rows) == len(votes)

        # Verify formula for first vote
        sample = votes[0]
        row = next(r for r in rows if r["player_id"] == sample["player_id"])
        role = pbi[sample["player_id"]]["role"]
        expected = float(sample["voto"])
        expected += 3 * sample["gol"] + 1 * sample["assist"]
        expected += 3 * sample["rigore_segnato"] - 3 * sample["rigore_sbagliato"]
        expected -= 0.5 if sample["ammoniz"] else 0
        expected -= 1 if sample["espuls"] else 0
        expected -= 2 * sample["autogol"]
        expected += 1 * sample.get("gol_vittoria", 0)
        expected += 0.5 * sample.get("gol_pareggio", 0)
        if role == "P":
            expected -= 1 * sample["gol_subiti"]
            expected += 3 * sample.get("rigore_parato", 0)
        expected = round(expected, 2)
        assert row["fantavoto"] == expected, f"formula mismatch got {row['fantavoto']} expected {expected}"

    def test_16_get_votes_non_member_403(self, session, user3):
        league = _STATE["league"]
        r = session.get(f"{API}/leagues/{league['id']}/votes/1", headers=auth_headers(user3["token"]))
        assert r.status_code == 403

    def test_17_results_matchday1(self, session, user1, user2):
        league = _STATE["league"]
        for u in [user1, user2]:
            r = session.get(f"{API}/leagues/{league['id']}/results/1", headers=auth_headers(u["token"]))
            assert r.status_code == 200
            data = r.json()
            assert data["matchday"] == 1
            results = data["results"]
            assert len(results) == 2
            assert results[0]["total"] >= results[1]["total"]
            assert results[0]["is_winner"] is True
            assert results[1]["is_winner"] is False
            assert results[0]["rank"] == 1
            assert results[1]["rank"] == 2

    def test_18_leaderboard(self, session, user1):
        league = _STATE["league"]
        r = session.get(f"{API}/leagues/{league['id']}/leaderboard", headers=auth_headers(user1["token"]))
        assert r.status_code == 200
        lb = r.json()["leaderboard"]
        assert len(lb) == 2
        assert lb[0]["points"] == 3
        assert lb[1]["points"] == 2

    def test_19_history(self, session, user1):
        league = _STATE["league"]
        r = session.get(f"{API}/leagues/{league['id']}/history", headers=auth_headers(user1["token"]))
        assert r.status_code == 200
        history = r.json()["history"]
        assert len(history) >= 1
        entry = next(h for h in history if h["matchday"] == 1)
        assert entry["winner_username"] is not None
        assert entry["winner_score"] > 0

    def test_20_non_owner_cannot_advance(self, session, user2):
        league = _STATE["league"]
        r = session.post(f"{API}/leagues/{league['id']}/advance", headers=auth_headers(user2["token"]))
        assert r.status_code == 403

    def test_21_owner_can_advance(self, session, user1):
        league = _STATE["league"]
        cur = session.get(f"{API}/leagues/{league['id']}", headers=auth_headers(user1["token"])).json()
        current_md = cur["current_matchday"]
        r = session.post(f"{API}/leagues/{league['id']}/advance", headers=auth_headers(user1["token"]))
        assert r.status_code == 200
        assert r.json()["current_matchday"] == current_md + 1


_STATE: dict = {}
