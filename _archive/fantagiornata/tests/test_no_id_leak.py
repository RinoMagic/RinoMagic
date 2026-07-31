"""Verify no MongoDB `_id` leaks in any response payload."""
import json
import requests
from conftest import API, auth_headers


def _walk(obj, path="root"):
    """Recursively check that no dict in the tree contains the key '_id'."""
    if isinstance(obj, dict):
        assert "_id" not in obj, f"MongoDB _id leaked at {path}: keys={list(obj.keys())}"
        for k, v in obj.items():
            _walk(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _walk(v, f"{path}[{i}]")


class TestNoIdLeak:
    def test_players_no_id(self, session, admin_token):
        r = session.get(f"{API}/players?role=A", headers=auth_headers(admin_token))
        assert r.status_code == 200
        _walk(r.json(), "GET /players")

    def test_teams_no_id(self, session, admin_token):
        r = session.get(f"{API}/teams", headers=auth_headers(admin_token))
        assert r.status_code == 200
        _walk(r.json(), "GET /teams")

    def test_me_no_id(self, session, admin_token):
        r = session.get(f"{API}/auth/me", headers=auth_headers(admin_token))
        assert r.status_code == 200
        _walk(r.json(), "GET /auth/me")

    def test_leagues_flow_no_id(self, session, admin_token, user1, user2):
        # Create league (owner=user1), user2 joins
        cr = session.post(f"{API}/leagues", json={"name": "TEST_NoIDLeak"}, headers=auth_headers(user1["token"]))
        assert cr.status_code == 200
        _walk(cr.json(), "POST /leagues")
        league = cr.json()

        jr = session.post(f"{API}/leagues/join", json={"code": league["code"]}, headers=auth_headers(user2["token"]))
        assert jr.status_code == 200
        _walk(jr.json(), "POST /leagues/join")

        lr = session.get(f"{API}/leagues", headers=auth_headers(user1["token"]))
        assert lr.status_code == 200
        _walk(lr.json(), "GET /leagues")

        gr = session.get(f"{API}/leagues/{league['id']}", headers=auth_headers(user1["token"]))
        assert gr.status_code == 200
        _walk(gr.json(), "GET /leagues/{id}")

        mr = session.get(f"{API}/leagues/{league['id']}/members", headers=auth_headers(user1["token"]))
        assert mr.status_code == 200
        _walk(mr.json(), "GET /leagues/{id}/members")

        # Submit lineup + vote to exercise votes/results/history endpoints
        players = session.get(f"{API}/players", headers=auth_headers(admin_token)).json()
        pids = [p["id"] for p in players[:22]]

        for u, starters in [(user1, pids[:11]), (user2, pids[11:22])]:
            r = session.post(
                f"{API}/leagues/{league['id']}/lineups",
                json={"matchday": 1, "module": "4-3-3", "starters": starters, "bench": []},
                headers=auth_headers(u["token"]),
            )
            assert r.status_code == 200
            _walk(r.json(), "POST /lineups")

        # Get lineup back
        gl = session.get(f"{API}/leagues/{league['id']}/lineups/1", headers=auth_headers(user1["token"]))
        assert gl.status_code == 200
        _walk(gl.json(), "GET /lineups/{md}")

        # Submit votes as owner
        votes = [{"player_id": pid, "voto": 6.5, "gol": 0, "assist": 0, "ammoniz": False,
                  "espuls": False, "autogol": 0, "gol_subiti": 0,
                  "rigore_segnato": 0, "rigore_sbagliato": 0} for pid in pids]
        vr = session.post(f"{API}/leagues/{league['id']}/votes",
                          json={"matchday": 1, "votes": votes},
                          headers=auth_headers(user1["token"]))
        assert vr.status_code == 200
        _walk(vr.json(), "POST /votes")

        # GET votes / results / leaderboard / history
        for endpoint in [
            f"/leagues/{league['id']}/votes/1",
            f"/leagues/{league['id']}/results/1",
            f"/leagues/{league['id']}/leaderboard",
            f"/leagues/{league['id']}/history",
        ]:
            r = session.get(f"{API}{endpoint}", headers=auth_headers(user1["token"]))
            assert r.status_code == 200, f"{endpoint} -> {r.status_code}"
            _walk(r.json(), f"GET {endpoint}")
