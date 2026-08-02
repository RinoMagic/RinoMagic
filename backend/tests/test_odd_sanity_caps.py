"""Anti-tamper: sanity caps on staryes.it odds.

The caller of :func:`thebesttiket._odd_exceeds_cap` must never be surprised by
a legit slip triggering the reject path — the caps have to be permissive
enough for real staryes.it odds while still catching Photoshopped ones (e.g.
"1" @ 1.85 turned into "1" @ 18.5).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from thebesttiket import (  # noqa: E402
    _max_odd_for_prediction,
    _odd_exceeds_cap,
)


class TestSimpleMarketsAccepted:
    """Realistic odds observed on staryes.it must NEVER trigger the reject."""

    def test_1x2_home_win(self):
        assert not _odd_exceeds_cap("1", 1.85)

    def test_1x2_underdog(self):
        assert not _odd_exceeds_cap("2", 15.0)

    def test_1x2_draw(self):
        assert not _odd_exceeds_cap("X", 3.4)

    def test_double_chance(self):
        assert not _odd_exceeds_cap("1X", 1.35)
        assert not _odd_exceeds_cap("X2", 1.8)

    def test_gol_nogol(self):
        assert not _odd_exceeds_cap("GOL", 1.75)
        assert not _odd_exceeds_cap("NOGOL", 2.1)

    def test_over_under(self):
        assert not _odd_exceeds_cap("OVER-2.5", 1.9)
        assert not _odd_exceeds_cap("UNDER-2.5", 1.85)
        assert not _odd_exceeds_cap("OVER-0.5", 1.05)
        assert not _odd_exceeds_cap("OVER-4.5", 12.0)  # rare but legit

    def test_multigol(self):
        assert not _odd_exceeds_cap("MG-1-3", 1.5)
        assert not _odd_exceeds_cap("MG-2-4", 2.0)

    def test_risultato_esatto(self):
        assert not _odd_exceeds_cap("RE-2-1", 12.0)
        assert not _odd_exceeds_cap("RE-3-2", 65.0)


class TestSimpleMarketsRejected:
    """Odds well above the sanity cap must be rejected."""

    def test_1x2_photoshopped_10x(self):
        # 1.85 → 18.5 (canonical photoshop attempt)
        assert _odd_exceeds_cap("1", 30.0)

    def test_double_chance_photoshopped(self):
        # 1X double chance never exceeds ~5x on staryes
        assert _odd_exceeds_cap("1X", 15.0)
        assert _odd_exceeds_cap("X2", 20.0)

    def test_gol_photoshopped(self):
        # GG rarely exceeds 3x
        assert _odd_exceeds_cap("GOL", 8.0)

    def test_over_photoshopped(self):
        assert _odd_exceeds_cap("OVER-2.5", 22.0)

    def test_multigol_photoshopped(self):
        assert _odd_exceeds_cap("MG-1-3", 30.0)

    def test_risultato_esatto_photoshopped(self):
        assert _odd_exceeds_cap("RE-2-1", 150.0)


class TestComboOdds:
    """Combos have larger caps but must still block obviously fake products."""

    def test_two_way_combo_legit(self):
        # 1X @ 1.4  +  GOL @ 1.85  ≈ 2.59
        assert not _odd_exceeds_cap("1X+GOL", 4.5)

    def test_two_way_combo_rejected(self):
        # 1X @ 1.4 * GOL @ 1.85 = 2.59, but slip shows 60x → reject
        assert _odd_exceeds_cap("1X+GOL", 60.0)

    def test_three_way_combo_legit(self):
        assert not _odd_exceeds_cap("1+OVER-2.5+GOL", 40.0)

    def test_three_way_combo_rejected(self):
        assert _odd_exceeds_cap("1+OVER-2.5+GOL", 300.0)

    def test_four_way_combo_rejected(self):
        # 4-atom combo cap is 600
        assert _odd_exceeds_cap("1+OVER-2.5+GOL+MG-1-3", 1000.0)


class TestBoundaryConditions:
    def test_zero_odd_never_flagged(self):
        # zero or negative just means "OCR couldn't read" — different error
        assert not _odd_exceeds_cap("1", 0.0)
        assert not _odd_exceeds_cap("1", -1.0)

    def test_empty_prediction(self):
        # Unknown market: cap is the global upper bound (999)
        assert not _odd_exceeds_cap("", 500.0)

    def test_tolerance_10_percent(self):
        # Cap is 25.0 for "1"; +10% = 27.5. 27.0 must pass, 28.0 must fail.
        assert not _odd_exceeds_cap("1", 27.0)
        assert _odd_exceeds_cap("1", 28.0)


class TestMaxOddValues:
    """Direct checks on the ``_max_odd_for_prediction`` public helper."""

    def test_1x2(self):
        assert _max_odd_for_prediction("1") == 25.0
        assert _max_odd_for_prediction("2") == 25.0
        assert _max_odd_for_prediction("X") == 8.0

    def test_double_chance(self):
        assert _max_odd_for_prediction("1X") == 8.0
        assert _max_odd_for_prediction("12") == 6.0

    def test_gol_family(self):
        assert _max_odd_for_prediction("GOL") == 5.0
        assert _max_odd_for_prediction("NOGOL") == 5.0

    def test_over_under_family(self):
        assert _max_odd_for_prediction("OVER-0.5") == 15.0
        assert _max_odd_for_prediction("UNDER-4.5") == 15.0

    def test_combo_product_capped(self):
        # 1X (8) × GOL (5) = 40 — under the 50 combo cap → 40 wins
        assert _max_odd_for_prediction("1X+GOL") == 40.0
        # 1 (25) × 2 (25) × GOL (5) = 3125 — capped at 200 (3 atoms)
        assert _max_odd_for_prediction("1+2+GOL") == 200.0
