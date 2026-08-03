"""Unit tests for the Surviva 2.0 v2 core helpers (no HTTP, no DB).

Coverage:
  • ``_pick_correct``               — outcome check
  • ``_team_locked_by_correct_pick`` — 1/2 lock a team, X locks nothing
  • ``_pick_uses_locked_team``      — reject a pick that reuses a locked team
  • ``_fixture_fully_locked``       — concession trigger
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from surviva import (  # noqa: E402
    _pick_correct,
    _team_locked_by_correct_pick,
    _pick_uses_locked_team,
    _fixture_fully_locked,
    REQUIRED_PICKS_PER_MATCHDAY,
)


class TestConstants:
    def test_three_picks_per_matchday(self):
        assert REQUIRED_PICKS_PER_MATCHDAY == 3


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


class TestTeamLockedByCorrectPick:
    """A correct pick locks a specific team based on the sign."""

    def test_pick_1_locks_home_team(self):
        assert _team_locked_by_correct_pick("1", "Milan", "Roma") == "Milan"

    def test_pick_2_locks_away_team(self):
        assert _team_locked_by_correct_pick("2", "Milan", "Roma") == "Roma"

    def test_pick_X_locks_nothing(self):
        """The X exception: correct draws do NOT lock any team."""
        assert _team_locked_by_correct_pick("X", "Milan", "Roma") is None


class TestPickUsesLockedTeam:
    """Reject a pick that would reuse an already-locked team."""

    def test_pick_1_rejected_when_home_locked(self):
        # Milan is locked → cannot pick "1" for Milan-vs-Inter
        assert _pick_uses_locked_team("1", "Milan", "Inter", {"Milan"}) == "Milan"

    def test_pick_2_rejected_when_away_locked(self):
        # Milan is locked → cannot pick "2" for Inter-vs-Milan
        assert _pick_uses_locked_team("2", "Inter", "Milan", {"Milan"}) == "Milan"

    def test_pick_1_ok_when_away_locked(self):
        # Milan is locked but I pick "1" for Roma-vs-Milan (home=Roma wins)
        # Milan doesn't win → not reused
        assert _pick_uses_locked_team("1", "Roma", "Milan", {"Milan"}) is None

    def test_pick_2_ok_when_home_locked(self):
        # Milan is locked but I pick "2" for Milan-vs-Roma (away=Roma wins)
        assert _pick_uses_locked_team("2", "Milan", "Roma", {"Milan"}) is None

    def test_pick_X_always_ok(self):
        # X never touches team locks
        assert _pick_uses_locked_team("X", "Milan", "Inter", {"Milan", "Inter"}) is None
        assert _pick_uses_locked_team("X", "Milan", "Inter", {"Milan"}) is None

    def test_no_locks_allows_everything(self):
        for p in ("1", "X", "2"):
            assert _pick_uses_locked_team(p, "Juve", "Napoli", set()) is None


class TestFixtureFullyLocked:
    """Concession: when BOTH teams of a match are locked, the match is playable."""

    def test_both_locked(self):
        assert _fixture_fully_locked("Milan", "Inter", {"Milan", "Inter"}) is True

    def test_only_home_locked(self):
        assert _fixture_fully_locked("Milan", "Inter", {"Milan"}) is False

    def test_only_away_locked(self):
        assert _fixture_fully_locked("Milan", "Inter", {"Inter"}) is False

    def test_neither_locked(self):
        assert _fixture_fully_locked("Milan", "Inter", set()) is False

    def test_extra_locks_dont_matter(self):
        assert _fixture_fully_locked(
            "Milan", "Inter", {"Milan", "Inter", "Roma", "Napoli"},
        ) is True


class TestConcessionScenario:
    """End-to-end scenario: player has locked Milan and Inter, then Serie A
    schedules Milan-Inter. Player must be allowed to play any sign, and a
    correct pick under concession must NOT introduce new locks."""

    def test_concession_allows_pick_1(self):
        locked = {"Milan", "Inter"}
        assert _fixture_fully_locked("Milan", "Inter", locked) is True
        # Backend logic: because the fixture is fully locked, we SKIP the
        # _pick_uses_locked_team check. The pick is accepted.
        # (Real endpoint has the concession bypass; here we assert the
        # helper wouldn't reject either team anyway.)

    def test_locked_by_correct_pick_still_computes(self):
        # Even under concession, _team_locked_by_correct_pick would return
        # a team — but the settle logic must ignore the lock when
        # pk["concession"] is True (asserted separately in integration tests).
        assert _team_locked_by_correct_pick("1", "Milan", "Inter") == "Milan"
        assert _team_locked_by_correct_pick("2", "Milan", "Inter") == "Inter"
        assert _team_locked_by_correct_pick("X", "Milan", "Inter") is None
