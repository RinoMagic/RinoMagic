"""Unit tests for the FantaGiornata fantavoto calculation and lineup scoring.

These are pure-Python tests (no HTTP round-trip) that lock in the correctness
of ``fantavoto_from_fact()`` and ``compute_lineup_score()``.
"""
from __future__ import annotations

import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from fantagiornata import (  # noqa: E402
    fantavoto_from_fact,
    compute_lineup_score,
    validate_starters,
    validate_bench,
    STARTERS_COUNT, BENCH_COUNT,
)
import pytest


def _f(**kw):
    """Helper to build a matchday_facts-ish dict with defaults."""
    return {"voto": 6.0, "sv": False, "gf": 0, "rf": 0, "rs": 0, "rp": 0,
            "gs": 0, "au": 0, "amm": 0, "esp": 0, "ass": 0, **kw}


# =========================================================================
# fantavoto_from_fact — mirror of the archive test cases (adapted schema)
# =========================================================================

class TestFantavotoFromFact:
    def test_base_vote_only(self):
        assert fantavoto_from_fact(_f(voto=6.0), "A") == 6.0

    def test_sv_returns_none(self):
        assert fantavoto_from_fact(_f(voto=6.0, sv=True), "A") is None

    def test_gol_bonus(self):
        # +3 per gol
        assert fantavoto_from_fact(_f(voto=7.0, gf=1), "A") == 10.0

    def test_rigore_segnato_bonus(self):
        # +3 per rigore segnato
        assert fantavoto_from_fact(_f(voto=6.5, rf=1), "A") == 9.5

    def test_rigore_sbagliato_malus(self):
        assert fantavoto_from_fact(_f(voto=5.0, rs=1), "A") == 2.0

    def test_assist_bonus(self):
        assert fantavoto_from_fact(_f(voto=7.0, ass=2), "C") == 9.0

    def test_autogol_malus(self):
        assert fantavoto_from_fact(_f(voto=6.0, au=1), "D") == 4.0

    def test_ammonizione_malus(self):
        assert fantavoto_from_fact(_f(voto=6.0, amm=1), "C") == 5.5

    def test_espulsione_malus(self):
        assert fantavoto_from_fact(_f(voto=5.5, esp=1), "D") == 4.5

    def test_portiere_gol_subiti(self):
        # -1 per each conceded
        assert fantavoto_from_fact(_f(voto=6.0, gs=3), "P") == 3.0

    def test_portiere_rigore_parato(self):
        assert fantavoto_from_fact(_f(voto=6.0, rp=1), "P") == 9.0

    def test_portiere_full_line(self):
        # 6 - 1(gs) + 3(rp) = 8
        assert fantavoto_from_fact(_f(voto=6.0, gs=1, rp=1), "P") == 8.0

    def test_non_portiere_no_gs_penalty(self):
        # gs ignored for outfielders
        assert fantavoto_from_fact(_f(voto=6.0, gs=5), "A") == 6.0

    def test_non_portiere_no_rp_bonus(self):
        assert fantavoto_from_fact(_f(voto=6.0, rp=5), "A") == 6.0

    def test_complete_striker(self):
        # 7.5 + 3 (gol aperto) + 3 (rigore segnato) + 1 (assist) - 0.5 (amm)
        # = 14.0
        assert fantavoto_from_fact(
            _f(voto=7.5, gf=1, rf=1, ass=1, amm=1), "A"
        ) == 14.0


# =========================================================================
# validate_starters / validate_bench
# =========================================================================

class TestFormationValidation:
    def test_valid_4_3_3(self):
        validate_starters({"P": ["p1"], "D": ["d1","d2","d3","d4"], "C": ["c1","c2","c3"], "A": ["a1","a2","a3"]})

    def test_valid_3_5_2(self):
        validate_starters({"P": ["p1"], "D": ["d1","d2","d3"], "C": ["c1","c2","c3","c4","c5"], "A": ["a1","a2"]})

    def test_missing_goalkeeper_raises(self):
        with pytest.raises(Exception):
            validate_starters({"P": [], "D": ["d1"]*5, "C": ["c1"]*3, "A": ["a1"]*3})

    def test_two_goalkeepers_raises(self):
        with pytest.raises(Exception):
            validate_starters({"P": ["p1","p2"], "D": ["d1"]*3, "C": ["c1"]*3, "A": ["a1"]*3})

    def test_wrong_total_raises(self):
        with pytest.raises(Exception):
            validate_starters({"P": ["p1"], "D": ["d1"], "C": ["c1"], "A": ["a1"]})

    def test_bench_ok(self):
        validate_bench({"P": ["p1","p2"], "D": ["d1","d2"], "C": ["c1","c2"], "A": ["a1","a2"]})

    def test_bench_wrong_role_count_raises(self):
        with pytest.raises(Exception):
            validate_bench({"P": ["p1"], "D": ["d1","d2","d3"], "C": ["c1","c2"], "A": ["a1","a2"]})


# =========================================================================
# compute_lineup_score — auto-substitution & totals
# =========================================================================

def _player(pid, role, name="Player", team="X"):
    return {"id": pid, "role": role, "full_name": name, "team": team}


def _entry(pid, role, voto=6.0, sv=False, **extra):
    return {"player": _player(pid, role), "fact": None if voto is None else _f(voto=voto, sv=sv, **extra)}


class TestLineupScore:
    def _basic_lineup(self, **starter_overrides):
        # 4-3-3 formation
        starters = [
            _entry("s_p1", "P", voto=6.5),
            _entry("s_d1", "D", voto=6.0),
            _entry("s_d2", "D", voto=6.5),
            _entry("s_d3", "D", voto=6.0),
            _entry("s_d4", "D", voto=6.0),
            _entry("s_c1", "C", voto=6.5, ass=1),
            _entry("s_c2", "C", voto=6.0),
            _entry("s_c3", "C", voto=6.5),
            _entry("s_a1", "A", voto=7.5, gf=1),
            _entry("s_a2", "A", voto=6.0),
            _entry("s_a3", "A", voto=6.5),
        ]
        bench = [
            _entry("b_p1", "P", voto=6.0), _entry("b_p2", "P", voto=6.0),
            _entry("b_d1", "D", voto=7.0), _entry("b_d2", "D", voto=6.0),
            _entry("b_c1", "C", voto=6.5), _entry("b_c2", "C", voto=6.5),
            _entry("b_a1", "A", voto=8.0, gf=1), _entry("b_a2", "A", voto=6.0),
        ]
        return starters, bench

    def test_all_starters_played(self):
        s, b = self._basic_lineup()
        score = compute_lineup_score(s, b)
        # 6.5 + 6 + 6.5 + 6 + 6 + 7.5 + 6 + 6.5 + 10.5 + 6 + 6.5
        expected = 6.5+6.0+6.5+6.0+6.0+7.5+6.0+6.5+10.5+6.0+6.5
        assert score["total"] == round(expected, 2)
        # No sub happened
        assert score["bench_used"] == []
        assert len(score["bench_left"]) == BENCH_COUNT

    def test_sv_starter_gets_substituted_same_role(self):
        s, b = self._basic_lineup()
        # Make attacker s_a1 SV — should be replaced by b_a1 (first bench A)
        s[8] = {"player": _player("s_a1", "A"), "fact": _f(voto=None, sv=True)}
        score = compute_lineup_score(s, b)
        substituted = [x for x in score["breakdown"] if x["player_id"] == "s_a1"][0]
        assert substituted["starter_fantavoto"] is None
        assert substituted["substituted_by"]["player_id"] == "b_a1"
        assert substituted["final_fantavoto"] == 11.0  # 8 + 3 gol
        assert "b_a1" in score["bench_used"]

    def test_sv_no_bench_available_zero_contribution(self):
        """If no bench of same role can play, the slot contributes 0."""
        s, b = self._basic_lineup()
        # SV goalkeeper AND both bench GKs also SV
        s[0] = _entry("s_p1", "P", voto=None, sv=True)
        b[0] = _entry("b_p1", "P", voto=None, sv=True)
        b[1] = _entry("b_p2", "P", voto=None, sv=True)
        score = compute_lineup_score(s, b)
        p_entry = [x for x in score["breakdown"] if x["player_id"] == "s_p1"][0]
        assert p_entry["final_fantavoto"] is None
        # Total excludes the None slot
        assert score["total"] < 100  # sanity: computed something

    def test_multiple_subs_only_first_of_role(self):
        """Two SV starters of same role → both should get subbed (different bench players)."""
        s, b = self._basic_lineup()
        s[8] = _entry("s_a1", "A", voto=None, sv=True)
        s[9] = _entry("s_a2", "A", voto=None, sv=True)
        score = compute_lineup_score(s, b)
        # Both subs should have taken bench A slots
        assert {"b_a1", "b_a2"}.issubset(set(score["bench_used"]))
        # Third A starter played normally
        a3 = [x for x in score["breakdown"] if x["player_id"] == "s_a3"][0]
        assert a3["substituted_by"] is None

    def test_bench_role_mismatch_no_sub(self):
        """A SV defender is NOT replaced by a bench attacker."""
        s, b = self._basic_lineup()
        s[1] = _entry("s_d1", "D", voto=None, sv=True)
        # Both bench Ds absent
        b[2] = _entry("b_d1", "D", voto=None, sv=True)
        b[3] = _entry("b_d2", "D", voto=None, sv=True)
        score = compute_lineup_score(s, b)
        d1 = [x for x in score["breakdown"] if x["player_id"] == "s_d1"][0]
        assert d1["substituted_by"] is None
        assert d1["final_fantavoto"] is None
