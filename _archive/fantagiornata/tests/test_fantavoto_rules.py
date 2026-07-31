"""Focused tests for the new fantavoto rules:
- Portiere: -1 per gol_subiti, +3 per rigore_parato
- Gol vittoria: +1 bonus
- Gol pareggio: +0.5 bonus
"""
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from server import fantavoto_from_vote


def test_gol_vittoria_bonus():
    fv = fantavoto_from_vote({"voto": 6.0, "gol": 1, "gol_vittoria": 1}, "A")
    assert fv == 6.0 + 3 + 1  # 10.0


def test_gol_pareggio_bonus():
    fv = fantavoto_from_vote({"voto": 6.0, "gol": 1, "gol_pareggio": 1}, "A")
    assert fv == 6.0 + 3 + 0.5  # 9.5


def test_portiere_gol_subiti_new_rule():
    # -1 per each conceded (not per 2)
    fv = fantavoto_from_vote({"voto": 6.0, "gol_subiti": 3}, "P")
    assert fv == 6.0 - 3  # 3.0


def test_portiere_rigore_parato():
    fv = fantavoto_from_vote({"voto": 6.0, "rigore_parato": 1}, "P")
    assert fv == 6.0 + 3  # 9.0


def test_portiere_full_line():
    # Voto 6, 1 gol subito, 1 rigore parato -> 6 - 1 + 3 = 8
    fv = fantavoto_from_vote(
        {"voto": 6.0, "gol_subiti": 1, "rigore_parato": 1}, "P"
    )
    assert fv == 8.0


def test_non_portiere_no_gol_subiti_penalty():
    # For attackers, gol_subiti is ignored
    fv = fantavoto_from_vote({"voto": 6.0, "gol_subiti": 5}, "A")
    assert fv == 6.0


def test_non_portiere_no_rigore_parato_bonus():
    fv = fantavoto_from_vote({"voto": 6.0, "rigore_parato": 5}, "A")
    assert fv == 6.0


def test_complete_striker_scenario():
    # Voto 7.5, 2 gol (uno vittoria), 1 assist, 1 rigore segnato, 1 ammoniz
    fv = fantavoto_from_vote(
        {
            "voto": 7.5,
            "gol": 2,
            "assist": 1,
            "ammoniz": True,
            "rigore_segnato": 1,
            "gol_vittoria": 1,
        },
        "A",
    )
    # 7.5 + 6 + 1 + 3 - 0.5 + 1 = 18
    assert fv == 18.0
