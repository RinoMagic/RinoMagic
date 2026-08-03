"""Unit tests for the Surviva 2.0 core helpers (no HTTP, no DB).

Coverage:
- Outcome derivation for each 1/X/2 pick
- Blocked-sign detection across home/away positions
- Pick correctness against final scores
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from surviva import (  # noqa: E402
    _team_outcomes_for_pick,
    _pick_is_blocked,
    _pick_correct,
)


class TestTeamOutcomes:
    def test_home_win_pick_1(self):
        home, away = _team_outcomes_for_pick("1")
        assert home == "W" and away == "L"

    def test_draw_pick_X(self):
        assert _team_outcomes_for_pick("X") == ("D", "D")

    def test_away_win_pick_2(self):
        assert _team_outcomes_for_pick("2") == ("L", "W")


class TestPickCorrect:
    def test_home_won_pick_1_correct(self):
        assert _pick_correct("1", 2, 1) is True

    def test_home_won_pick_X_wrong(self):
        assert _pick_correct("X", 2, 1) is False

    def test_home_won_pick_2_wrong(self):
        assert _pick_correct("2", 2, 1) is False

    def test_draw_pick_X_correct(self):
        assert _pick_correct("X", 1, 1) is True

    def test_away_won_pick_2_correct(self):
        assert _pick_correct("2", 0, 3) is True

    def test_zero_zero_is_draw(self):
        assert _pick_correct("X", 0, 0) is True
        assert _pick_correct("1", 0, 0) is False
        assert _pick_correct("2", 0, 0) is False


class TestBlockedSignsHomeTeam:
    """Verify that a previously-guessed 'Inter → Vittoria' blocks the sign
    regardless of whether Inter plays at home or away."""

    def setup_method(self):
        # In matchday 3 the user correctly guessed Inter → Vittoria while
        # Inter was playing at home ("Inter vs Milan → 1")
        self.blocked = [
            {"team": "Inter", "outcome": "W", "matchday": 3},
            {"team": "Milan", "outcome": "L", "matchday": 3},
        ]

    def test_cannot_pick_1_when_inter_home(self):
        # Inter vs Roma → 1 means Inter=W (blocked)
        offender = _pick_is_blocked("1", "Inter", "Roma", self.blocked)
        assert offender is not None
        assert offender["team"] == "Inter"

    def test_cannot_pick_2_when_inter_away(self):
        # Roma vs Inter → 2 means Inter=W (blocked, even away!)
        offender = _pick_is_blocked("2", "Roma", "Inter", self.blocked)
        assert offender is not None
        assert offender["team"] == "Inter"

    def test_can_pick_X_when_inter_plays(self):
        # X = draw = Inter=D, not blocked
        assert _pick_is_blocked("X", "Inter", "Roma", self.blocked) is None
        assert _pick_is_blocked("X", "Roma", "Inter", self.blocked) is None

    def test_can_pick_inter_defeat_at_home(self):
        # Inter=L is not blocked (only Inter=W is)
        assert _pick_is_blocked("2", "Inter", "Napoli", self.blocked) is None

    def test_can_pick_inter_defeat_away(self):
        # Napoli vs Inter → 1 means Inter=L (not blocked, only Inter=W is)
        assert _pick_is_blocked("1", "Napoli", "Inter", self.blocked) is None


class TestBlockedSignsDraw:
    def setup_method(self):
        # User has guessed a draw for Milan (Milan → D)
        self.blocked = [
            {"team": "Milan", "outcome": "D", "matchday": 5},
            {"team": "Inter", "outcome": "D", "matchday": 5},
        ]

    def test_cannot_pick_X_with_milan(self):
        # Milan vs Roma → X means Milan=D (blocked)
        assert _pick_is_blocked("X", "Milan", "Roma", self.blocked) is not None
        assert _pick_is_blocked("X", "Roma", "Milan", self.blocked) is not None

    def test_can_pick_1_or_2_with_milan(self):
        assert _pick_is_blocked("1", "Milan", "Roma", self.blocked) is None
        assert _pick_is_blocked("2", "Milan", "Roma", self.blocked) is None
        assert _pick_is_blocked("1", "Roma", "Milan", self.blocked) is None


class TestBlockedSignsEmpty:
    def test_no_blocks_allows_everything(self):
        for pick in ("1", "X", "2"):
            assert _pick_is_blocked(pick, "Juve", "Napoli", []) is None
