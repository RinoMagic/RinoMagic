"""Regression tests for the staryes.it OCR pipeline on real user screenshots.

Each fixture is a screenshot the user has previously reported as problematic
or wants to lock in as a passing case. Every event on every fixture must have
a non-empty prediction — this prevents "MERCATO NON AMMESSO" states from
reappearing after refactors.
"""
from __future__ import annotations

import asyncio
import pathlib
import pytest

import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from server import ocr_screenshot  # noqa: E402


FIX = pathlib.Path(__file__).parent / "fixtures"


def _run(image_path: pathlib.Path) -> list[dict]:
    assert image_path.exists(), f"Missing fixture: {image_path}"
    raw = image_path.read_bytes()
    result = asyncio.get_event_loop().run_until_complete(ocr_screenshot(raw))
    return result["events"]


# =========================================================================
# Fixture: staryes_re_multigol.webp — Risultato Esatto + Multigol + combo
# =========================================================================

def test_re_and_multigol_mixed():
    """IMG_2343: 1X+GG, 1X+U/O 1.5, Risultato Esatto 0-2, Multigol 1-3, RE 2-1."""
    events = _run(FIX / "staryes_re_multigol.webp")
    by_teams = {(e["home_team"], e["away_team"]): e for e in events}
    assert by_teams[("Torino", "Milan")]["prediction"] == "1X+GOL"
    assert by_teams[("Parma", "Cagliari")]["prediction"] == "1X+UNDER-1.5"
    assert by_teams[("Udinese", "Como")]["prediction"] == "RE-0-2"
    assert by_teams[("Genoa", "Napoli")]["prediction"] == "MG-1-3"
    assert by_teams[("Inter", "Monza")]["prediction"] == "RE-2-1"


# =========================================================================
# Fixture: staryes_dnb_dc.webp — Draw No Bet + Double Chance
# =========================================================================

def test_draw_no_bet_and_dc():
    """IMG_2337: 1X2, X2, 1X, DRAW NO BET 2, X2 + GG combo."""
    events = _run(FIX / "staryes_dnb_dc.webp")
    by_teams = {(e["home_team"], e["away_team"]): e for e in events}
    assert by_teams[("Atalanta", "Sassuolo")]["prediction"] == "2"
    assert by_teams[("Venezia", "Lecce")]["prediction"] == "X2"
    assert by_teams[("Frosinone", "Juventus")]["prediction"] == "1X"
    # Draw No Bet with pick "2" collapses to "2" (see server._classify_bet docstring)
    assert by_teams[("Roma", "Fiorentina")]["prediction"] == "2"
    assert by_teams[("Genoa", "Napoli")]["prediction"] == "X2+GOL"


# =========================================================================
# Fixture: staryes_gg_combo_full.png — Combo GG/NG + Multigol + U/O
# =========================================================================

def test_gg_combos_and_multigol_combo():
    """image.png: 1X+MG 1-3, 1X+NG, 1+NG, U/O+GG combo, 1+UN combo."""
    events = _run(FIX / "staryes_gg_combo_full.png")
    by_teams = {(e["home_team"], e["away_team"]): e for e in events}
    assert by_teams[("Frosinone", "Juventus")]["prediction"] == "1X+MG-1-3"
    assert by_teams[("Parma", "Cagliari")]["prediction"] == "1X+NOGOL"
    assert by_teams[("Genoa", "Napoli")]["prediction"] == "1+NOGOL"
    assert by_teams[("Udinese", "Como")]["prediction"] == "OVER-2.5+GOL"
    assert by_teams[("Inter", "Monza")]["prediction"] == "1+UNDER-1.5"


# =========================================================================
# Fixture: staryes_uo_dc.webp — All U/O 1.5 combos (DC + U/O)
# =========================================================================

def test_uo_double_chance_combos():
    """IMG_2352: 5 combos with U/O 1.5 threshold (X2/1X/1 sides)."""
    events = _run(FIX / "staryes_uo_dc.webp")
    by_teams = {(e["home_team"], e["away_team"]): e for e in events}
    assert by_teams[("Frosinone", "Juventus")]["prediction"] == "X2+UNDER-1.5"
    assert by_teams[("Parma", "Cagliari")]["prediction"] == "1X+OVER-1.5"
    assert by_teams[("Genoa", "Napoli")]["prediction"] == "1X+UNDER-1.5"
    assert by_teams[("Udinese", "Como")]["prediction"] == "1+OVER-1.5"
    assert by_teams[("Inter", "Monza")]["prediction"] == "1+UNDER-1.5"


# =========================================================================
# Fixture: staryes_1x2_gg.webp — 1X2 + GG/NG combos & mixed U/O thresholds
# =========================================================================

def test_1x2_gg_and_mixed_thresholds():
    """IMG_2353: 1+GG, 1+NG, 12+U/O 4.5+OV, 12+U/O 2.5+UN, X2+U/O 1.5+OV."""
    events = _run(FIX / "staryes_1x2_gg.webp")
    by_teams = {(e["home_team"], e["away_team"]): e for e in events}
    assert by_teams[("Venezia", "Lecce")]["prediction"] == "1+GOL"
    assert by_teams[("Frosinone", "Juventus")]["prediction"] == "1+NOGOL"
    assert by_teams[("Genoa", "Napoli")]["prediction"] == "12+OVER-4.5"
    assert by_teams[("Udinese", "Como")]["prediction"] == "12+UNDER-2.5"
    assert by_teams[("Inter", "Monza")]["prediction"] == "X2+OVER-1.5"


# =========================================================================
# Fixture: staryes_dc_gg_only.webp — Only DC + GG/NG combos
# =========================================================================

def test_dc_gg_full_slip():
    """IMG_2354: 5 combos DC + GG/NG (12/X2/1X sides)."""
    events = _run(FIX / "staryes_dc_gg_only.webp")
    by_teams = {(e["home_team"], e["away_team"]): e for e in events}
    assert by_teams[("Frosinone", "Juventus")]["prediction"] == "12+GOL"
    assert by_teams[("Parma", "Cagliari")]["prediction"] == "X2+NOGOL"
    assert by_teams[("Genoa", "Napoli")]["prediction"] == "X2+GOL"
    assert by_teams[("Udinese", "Como")]["prediction"] == "1X+NOGOL"
    assert by_teams[("Inter", "Monza")]["prediction"] == "1X+GOL"


# =========================================================================
# Fixture: staryes_sistemi_multigol.webp — Sistemi view w/ Multigol combos
# =========================================================================

def test_sistemi_multigol_combos():
    """IMG_2355 (Sistemi): U/O 2.5 + GG/NG combos and 12/X2 + Multigol 1-2.

    NB: The bottom event is truncated in the screenshot (visible team header
    but no pick line), so we only assert the first 4 events.
    """
    events = _run(FIX / "staryes_sistemi_multigol.webp")
    by_teams = {(e["home_team"], e["away_team"]): e for e in events}
    assert by_teams[("Venezia", "Lecce")]["prediction"] == "OVER-2.5+GOL"
    assert by_teams[("Frosinone", "Juventus")]["prediction"] == "UNDER-2.5+GOL"
    assert by_teams[("Genoa", "Napoli")]["prediction"] == "12+MG-1-2"
    assert by_teams[("Udinese", "Como")]["prediction"] == "X2+MG-1-2"


# =========================================================================
# Meta test: no fixture should produce empty predictions
# =========================================================================

@pytest.mark.parametrize("filename", [
    "staryes_re_multigol.webp",
    "staryes_dnb_dc.webp",
    "staryes_gg_combo_full.png",
    "staryes_uo_dc.webp",
    "staryes_1x2_gg.webp",
    "staryes_dc_gg_only.webp",
])
def test_no_unknown_predictions(filename):
    """Every event on every fully-visible bet slip must have a non-empty
    prediction — this catches OCR regressions that would surface as
    'MERCATO NON AMMESSO' in the UI."""
    events = _run(FIX / filename)
    unknown = [e for e in events if not e.get("prediction")]
    assert not unknown, f"{filename}: unknown predictions: {unknown}"
