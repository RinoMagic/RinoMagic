"""
Iteration 5 tests for FantaGiornata:
- Bench composition validation (empty vs 8 with 2P+2D+2C+2A)
- Auto-substitution logic in results + history
- votes/sync/{md} endpoint owner-gating & no-external-id path
All tests kept in one class to guarantee same worker (pytest-xdist loadscope) since state is shared.
"""
import pytest
from conftest import API, auth_headers, _register, _login


def _fresh_user(session, tag):
    import uuid
    suffix = uuid.uuid4().hex[:8]
    email = f"TEST_{tag}_{suffix}@test.com"
    r = _register(session, email, "Passw0rd!", f"TEST{tag}{suffix}")
    assert r.status_code == 201, f"register {tag} failed: {r.status_code} {r.text}"
    return {"email": email, "token": r.json()["access_token"]}


class TestBenchAndSubstitution:
    _STATE: dict = {}

    def test_00_setup_users_and_league(self, session):
        a = _fresh_user(session, "userA")
        b = _fresh_user(session, "userB")
        c = _fresh_user(session, "userC")  # non-member
        self._STATE["a"] = a
        self._STATE["b"] = b
        self._STATE["c"] = c
        r = session.post(f"{API}/leagues", json={"name": "TEST_Bench Lega"},
                         headers=auth_headers(a["token"]))
        assert r.status_code == 200
        league = r.json()
        self._STATE["league"] = league

        r = session.post(f"{API}/leagues/join", json={"code": league["code"]},
                         headers=auth_headers(b["token"]))
        assert r.status_code == 200

    def test_01_fetch_players_by_role(self, session):
        r = session.get(f"{API}/players", headers=auth_headers(self._STATE["a"]["token"]))
        assert r.status_code == 200
        players = r.json()
        by_role = {"P": [], "D": [], "C": [], "A": []}
        for p in players:
            if p["role"] in by_role:
                by_role[p["role"]].append(p)
        assert len(by_role["P"]) >= 5
        assert len(by_role["D"]) >= 15
        assert len(by_role["C"]) >= 15
        assert len(by_role["A"]) >= 10
        self._STATE["by_role"] = by_role
        self._STATE["players_by_id"] = {p["id"]: p for p in players}

    def _build_lineup_a(self):
        """User A: 4-4-3 -> 1P + 4D + 4C + 3A = 12? we need 11.
        Use 1P + 4D + 3C + 3A = 11 starters. Bench 2P+2D+2C+2A = 8.
        """
        br = self._STATE["by_role"]
        starters_p = [br["P"][0]["id"]]
        starters_d = [p["id"] for p in br["D"][0:4]]
        starters_c = [p["id"] for p in br["C"][0:3]]
        starters_a = [p["id"] for p in br["A"][0:3]]
        starters = starters_p + starters_d + starters_c + starters_a
        assert len(starters) == 11 and len(set(starters)) == 11

        bench_p = [br["P"][1]["id"], br["P"][2]["id"]]
        bench_d = [br["D"][4]["id"], br["D"][5]["id"]]
        bench_c = [br["C"][3]["id"], br["C"][4]["id"]]
        bench_a = [br["A"][3]["id"], br["A"][4]["id"]]
        bench = bench_p + bench_d + bench_c + bench_a
        assert len(bench) == 8 and len(set(bench)) == 8
        return starters, bench

    def _build_lineup_b(self):
        br = self._STATE["by_role"]
        # Use different players from A's set (offset >= 6)
        starters_p = [br["P"][3]["id"]]
        starters_d = [p["id"] for p in br["D"][6:10]]
        starters_c = [p["id"] for p in br["C"][5:8]]
        starters_a = [p["id"] for p in br["A"][5:8]]
        starters = starters_p + starters_d + starters_c + starters_a
        assert len(starters) == 11 and len(set(starters)) == 11

        bench_p = [br["P"][4]["id"], br["P"][5 % len(br["P"])]["id"]]
        # ensure bench_p unique -> just pick from a wider range
        bench_p = list(dict.fromkeys([br["P"][4]["id"]]))
        # Add another P via wrap - but our fixture likely has >=5 P so pick idx 5 if exists else fail
        # Grab 2 distinct P not already used
        used_p = set(starters_p) | set(bench_p)
        for p in br["P"]:
            if p["id"] not in used_p:
                bench_p.append(p["id"])
                used_p.add(p["id"])
                if len(bench_p) == 2:
                    break
        assert len(bench_p) == 2, "not enough P in seed"

        bench_d = [br["D"][10]["id"], br["D"][11]["id"]]
        bench_c = [br["C"][8]["id"], br["C"][9]["id"]]
        bench_a = [br["A"][8]["id"], br["A"][9]["id"]]
        bench = bench_p + bench_d + bench_c + bench_a
        assert len(bench) == 8 and len(set(bench)) == 8
        return starters, bench

    def test_02_valid_lineup_with_8_bench_A(self, session):
        starters, bench = self._build_lineup_a()
        self._STATE["starters_a"] = starters
        self._STATE["bench_a"] = bench
        league = self._STATE["league"]
        r = session.post(f"{API}/leagues/{league['id']}/lineups",
                         json={"matchday": 1, "module": "4-3-3",
                               "starters": starters, "bench": bench},
                         headers=auth_headers(self._STATE["a"]["token"]))
        assert r.status_code == 200, f"got {r.status_code} {r.text}"

    def test_03_valid_lineup_with_8_bench_B(self, session):
        starters, bench = self._build_lineup_b()
        self._STATE["starters_b"] = starters
        self._STATE["bench_b"] = bench
        league = self._STATE["league"]
        r = session.post(f"{API}/leagues/{league['id']}/lineups",
                         json={"matchday": 1, "module": "4-3-3",
                               "starters": starters, "bench": bench},
                         headers=auth_headers(self._STATE["b"]["token"]))
        assert r.status_code == 200, f"got {r.status_code} {r.text}"

    def test_04_bench_of_7_fails(self, session):
        _, bench = self._build_lineup_a()
        league = self._STATE["league"]
        r = session.post(f"{API}/leagues/{league['id']}/lineups",
                         json={"matchday": 2, "module": "4-3-3",
                               "starters": self._STATE["starters_a"], "bench": bench[:7]},
                         headers=auth_headers(self._STATE["a"]["token"]))
        assert r.status_code == 400
        assert "8 giocatori" in r.json()["detail"] or "panchina" in r.json()["detail"].lower()

    def test_05_bench_wrong_composition_3P_2D_2C_1A(self, session):
        br = self._STATE["by_role"]
        starters = self._STATE["starters_a"]
        # Bench: 3P + 2D + 2C + 1A = 8 but wrong composition
        used = set(starters)
        p_extras = [p["id"] for p in br["P"] if p["id"] not in used][:3]
        d_extras = [p["id"] for p in br["D"] if p["id"] not in used][:2]
        c_extras = [p["id"] for p in br["C"] if p["id"] not in used][:2]
        a_extras = [p["id"] for p in br["A"] if p["id"] not in used][:1]
        bad_bench = p_extras + d_extras + c_extras + a_extras
        assert len(bad_bench) == 8 and len(set(bad_bench)) == 8

        league = self._STATE["league"]
        r = session.post(f"{API}/leagues/{league['id']}/lineups",
                         json={"matchday": 2, "module": "4-3-3",
                               "starters": starters, "bench": bad_bench},
                         headers=auth_headers(self._STATE["a"]["token"]))
        assert r.status_code == 400, f"got {r.status_code} {r.text}"
        detail = r.json()["detail"]
        assert "Composizione" in detail or "composizione" in detail, f"expected composition error: {detail}"

    def test_06_bench_with_duplicate_fails(self, session):
        starters, bench = self._build_lineup_a()
        dup_bench = bench[:7] + [bench[0]]  # duplicate first
        league = self._STATE["league"]
        r = session.post(f"{API}/leagues/{league['id']}/lineups",
                         json={"matchday": 2, "module": "4-3-3",
                               "starters": starters, "bench": dup_bench},
                         headers=auth_headers(self._STATE["a"]["token"]))
        assert r.status_code == 400
        assert "duplicati" in r.json()["detail"].lower()

    def test_07_bench_overlap_with_starters_fails(self, session):
        starters, bench = self._build_lineup_a()
        # Replace last bench with a starter - but keep composition matching for D (starters[1] is D)
        # bench[7] is A → swap with starters_d[0] wouldn't preserve role. Just swap same-role.
        # bench positions: [P,P,D,D,C,C,A,A]. bench[2] is D. starter[1] is D.
        overlap_bench = list(bench)
        overlap_bench[2] = starters[1]  # both D
        league = self._STATE["league"]
        r = session.post(f"{API}/leagues/{league['id']}/lineups",
                         json={"matchday": 2, "module": "4-3-3",
                               "starters": starters, "bench": overlap_bench},
                         headers=auth_headers(self._STATE["a"]["token"]))
        assert r.status_code == 400, f"got {r.status_code} {r.text}"

    def test_08_bench_invalid_id_fails(self, session):
        starters, bench = self._build_lineup_a()
        bad_bench = bench[:7] + ["nonexistent-player-id-xyz"]
        league = self._STATE["league"]
        r = session.post(f"{API}/leagues/{league['id']}/lineups",
                         json={"matchday": 2, "module": "4-3-3",
                               "starters": starters, "bench": bad_bench},
                         headers=auth_headers(self._STATE["a"]["token"]))
        assert r.status_code == 400

    def test_09_bench_empty_still_ok_backward_compat(self, session):
        league = self._STATE["league"]
        r = session.post(f"{API}/leagues/{league['id']}/lineups",
                         json={"matchday": 2, "module": "4-3-3",
                               "starters": self._STATE["starters_a"], "bench": []},
                         headers=auth_headers(self._STATE["a"]["token"]))
        assert r.status_code == 200

    def test_10_owner_submits_partial_votes_with_bench_D_vote(self, session):
        """Submit votes for all A's starters except one D starter.
        DO submit vote for the first bench D player of A so substitution can happen.
        Also submit votes for B's starters so B has a total.
        """
        league = self._STATE["league"]
        starters_a = self._STATE["starters_a"]
        bench_a = self._STATE["bench_a"]
        starters_b = self._STATE["starters_b"]
        players_by_id = self._STATE["players_by_id"]

        # Identify one D starter in A to skip
        d_starters_a = [pid for pid in starters_a if players_by_id[pid]["role"] == "D"]
        skip_pid = d_starters_a[0]  # this one gets no vote → should be substituted
        self._STATE["skip_pid"] = skip_pid

        # First bench D of A (bench_a index 2)
        first_bench_d_a = [pid for pid in bench_a if players_by_id[pid]["role"] == "D"][0]
        self._STATE["expected_sub_pid"] = first_bench_d_a

        votes = []
        # Votes for A starters except skip_pid
        for pid in starters_a:
            if pid == skip_pid:
                continue
            role = players_by_id[pid]["role"]
            votes.append({"player_id": pid, "voto": 6.5, "gol": 0, "assist": 0,
                          "ammoniz": False, "espuls": False, "autogol": 0,
                          "gol_subiti": 1 if role == "P" else 0,
                          "rigore_segnato": 0, "rigore_sbagliato": 0})
        # Vote for first bench D of A → 7.0 fantavoto
        votes.append({"player_id": first_bench_d_a, "voto": 7.0, "gol": 0, "assist": 0,
                      "ammoniz": False, "espuls": False, "autogol": 0,
                      "gol_subiti": 0, "rigore_segnato": 0, "rigore_sbagliato": 0})
        # Votes for B starters (uniform 6.0)
        for pid in starters_b:
            role = players_by_id[pid]["role"]
            votes.append({"player_id": pid, "voto": 6.0, "gol": 0, "assist": 0,
                          "ammoniz": False, "espuls": False, "autogol": 0,
                          "gol_subiti": 1 if role == "P" else 0,
                          "rigore_segnato": 0, "rigore_sbagliato": 0})

        r = session.post(f"{API}/leagues/{league['id']}/votes",
                         json={"matchday": 1, "votes": votes},
                         headers=auth_headers(self._STATE["a"]["token"]))
        assert r.status_code == 200
        assert r.json()["count"] == len(votes)

    def test_11_results_show_substitution(self, session):
        league = self._STATE["league"]
        r = session.get(f"{API}/leagues/{league['id']}/results/1",
                        headers=auth_headers(self._STATE["a"]["token"]))
        assert r.status_code == 200
        data = r.json()
        assert data["matchday"] == 1
        results = data["results"]
        assert len(results) == 2

        # A's row
        a_row = next(r for r in results if r["user_id"] and r.get("username", "").startswith("TESTuserA"))
        assert "substitutions" in a_row
        assert len(a_row["substitutions"]) == 1, f"expected 1 sub, got {a_row['substitutions']}"
        sub = a_row["substitutions"][0]
        assert sub["out"] == self._STATE["skip_pid"]
        assert sub["in"] == self._STATE["expected_sub_pid"]

        # Breakdown row for skipped starter must be substituted=True with sub_player_id
        skipped_row = next(x for x in a_row["breakdown"] if x["player_id"] == self._STATE["skip_pid"])
        assert skipped_row["substituted"] is True
        assert skipped_row.get("sub_player_id") == self._STATE["expected_sub_pid"]
        assert skipped_row["has_vote"] is True
        assert skipped_row["fantavoto"] == 7.0

        # B row: no subs
        b_row = next(r for r in results if r["user_id"] != a_row["user_id"])
        assert b_row["substitutions"] == [], f"B should have no subs got {b_row['substitutions']}"
        assert all(x["substituted"] is False for x in b_row["breakdown"])

        # Ranks + winner (whoever has higher total)
        assert results[0]["total"] >= results[1]["total"]
        assert results[0]["is_winner"] is True
        assert results[1]["is_winner"] is False

    def test_12_history_returns_ok(self, session):
        """History uses same _compute_user_total helper (substitutions applied)."""
        league = self._STATE["league"]
        r = session.get(f"{API}/leagues/{league['id']}/history",
                        headers=auth_headers(self._STATE["a"]["token"]))
        assert r.status_code == 200
        hist = r.json()["history"]
        entry = next(h for h in hist if h["matchday"] == 1)
        assert entry["winner_username"] is not None
        assert entry["winner_score"] > 0

    def test_13_sync_votes_non_owner_403(self, session):
        league = self._STATE["league"]
        r = session.post(f"{API}/leagues/{league['id']}/votes/sync/1?season=2024",
                         headers=auth_headers(self._STATE["b"]["token"]))
        assert r.status_code == 403
        assert "proprietario" in r.json()["detail"].lower() or "owner" in r.json()["detail"].lower()

    def test_14_sync_votes_owner_no_external_id_or_upstream_error(self, session):
        """Either no external_id → 400 'La rosa non e sincronizzata...'
        or if some external_id exists → 400 'API-Football: <suspended>'.
        Both are acceptable 400s per iteration 4 spec (account suspended).
        """
        league = self._STATE["league"]
        r = session.post(f"{API}/leagues/{league['id']}/votes/sync/1?season=2024",
                         headers=auth_headers(self._STATE["a"]["token"]))
        assert r.status_code == 400, f"expected 400 got {r.status_code} {r.text}"
        detail = r.json()["detail"]
        acceptable = ("rosa non" in detail.lower() or "sincronizzata" in detail.lower()
                      or detail.startswith("API-Football:"))
        assert acceptable, f"unexpected 400 detail: {detail}"

    def test_15_sync_votes_non_member_also_403(self, session):
        """A user who is not even a member: expect 403 (owner check comes after league lookup)."""
        league = self._STATE["league"]
        r = session.post(f"{API}/leagues/{league['id']}/votes/sync/1?season=2024",
                         headers=auth_headers(self._STATE["c"]["token"]))
        assert r.status_code == 403

    def test_16_sync_votes_league_not_found_404(self, session):
        r = session.post(f"{API}/leagues/nonexistent-lg-id/votes/sync/1?season=2024",
                         headers=auth_headers(self._STATE["a"]["token"]))
        assert r.status_code == 404
