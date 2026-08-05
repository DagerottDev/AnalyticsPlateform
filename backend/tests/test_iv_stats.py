"""Tests for the shared IV Rank / IV Percentile math."""

import pytest

from app.services.iv_stats import iv_percentile, iv_rank


class TestIvRank:
    def test_current_at_low_end_is_zero(self):
        assert iv_rank([0.10, 0.20, 0.30], 0.10) == 0.0

    def test_current_at_high_end_is_hundred(self):
        assert iv_rank([0.10, 0.20, 0.30], 0.30) == 100.0

    def test_current_at_midpoint_is_fifty(self):
        assert iv_rank([0.10, 0.30], 0.20) == pytest.approx(50.0)

    def test_flat_history_returns_zero_without_dividing_by_zero(self):
        assert iv_rank([0.15, 0.15, 0.15], 0.15) == 0.0

    def test_rank_is_bounded_when_current_is_outside_history(self):
        assert iv_rank([0.10, 0.20, 0.30], 0.40) == 100.0
        assert iv_rank([0.10, 0.20, 0.30], 0.05) == 0.0


class TestIvPercentile:
    def test_current_below_everything_is_zero(self):
        assert iv_percentile([0.20, 0.30, 0.40], 0.10) == 0.0

    def test_current_above_everything_is_hundred(self):
        assert iv_percentile([0.10, 0.20, 0.30], 0.99) == 100.0

    def test_current_above_half_the_history(self):
        assert iv_percentile([0.10, 0.20, 0.30, 0.40], 0.25) == 50.0

    def test_current_observation_is_not_part_of_the_denominator(self):
        assert iv_percentile([0.10, 0.20, 0.30], 0.30) == pytest.approx(66.6666667)
