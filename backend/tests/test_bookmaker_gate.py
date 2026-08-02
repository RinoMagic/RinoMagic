"""Anti-cheat: only staryes.it bet slips are accepted by TheBestTiket.

Covers the pure helpers exposed by :mod:`thebesttiket` (no HTTP calls, no
LLM): both the positive check (LLM-provided "bookmaker" name) and the
negative heuristic (Tesseract raw-text keyword scan) must correctly classify
staryes vs non-staryes.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from thebesttiket import _is_staryes_bookmaker, _detect_non_staryes_hint  # noqa: E402


class TestIsStaryesBookmaker:
    """The positive check: is the LLM-reported bookmaker acceptable?"""

    def test_bare_staryes(self):
        assert _is_staryes_bookmaker("staryes") is True

    def test_staryes_dot_it(self):
        assert _is_staryes_bookmaker("staryes.it") is True

    def test_with_uppercase_and_spaces(self):
        assert _is_staryes_bookmaker("  STARYES  ") is True

    def test_star_yes_two_words(self):
        assert _is_staryes_bookmaker("Star Yes") is True

    def test_starcasino_alias(self):
        # staryes shares brand with starcasino — accept both
        assert _is_staryes_bookmaker("starcasino") is True

    def test_snai_rejected(self):
        assert _is_staryes_bookmaker("snai") is False

    def test_bet365_rejected(self):
        assert _is_staryes_bookmaker("bet365") is False

    def test_sisal_rejected(self):
        assert _is_staryes_bookmaker("sisal") is False

    def test_unknown_rejected(self):
        assert _is_staryes_bookmaker("unknown") is False

    def test_empty_rejected(self):
        assert _is_staryes_bookmaker("") is False

    def test_none_rejected(self):
        assert _is_staryes_bookmaker(None) is False

    def test_placeholder_symbols_rejected(self):
        assert _is_staryes_bookmaker("?") is False
        assert _is_staryes_bookmaker("n/a") is False


class TestDetectNonStaryesHint:
    """The negative heuristic used by the Tesseract fallback."""

    def test_snai_header_detected(self):
        text = "SNAI\nCALCIO - SERIE A\n7965 FROSINONE - JUVENTUS\n1X2: 2   1.46"
        assert _detect_non_staryes_hint(text) == "SNAI"

    def test_sisal_detected(self):
        text = "SISAL Matchpoint\nLazio - Roma"
        assert _detect_non_staryes_hint(text) == "SISAL"

    def test_bet365_detected(self):
        text = "Bet365 Sports\nJuventus vs Milan"
        assert _detect_non_staryes_hint(text) == "BET365"

    def test_goldbet_detected(self):
        text = "Header GOLDBET.it schedina\nInter - Napoli"
        assert _detect_non_staryes_hint(text) == "GOLDBET"

    def test_planetwin_with_space(self):
        text = "PLANET WIN 365\nAtalanta - Torino"
        assert _detect_non_staryes_hint(text) == "PLANET WIN"

    def test_staryes_text_returns_none(self):
        text = "STARYES.IT bet slip\nCALCIO - SERIE A\n1X2: 1   1.85"
        assert _detect_non_staryes_hint(text) is None

    def test_generic_serie_a_returns_none(self):
        text = "CALCIO - SERIE A\nFROSINONE - JUVENTUS\n1X2: 2   1.46"
        assert _detect_non_staryes_hint(text) is None

    def test_empty_text_returns_none(self):
        assert _detect_non_staryes_hint("") is None
        assert _detect_non_staryes_hint(None) is None
