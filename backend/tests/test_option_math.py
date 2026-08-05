"""Tests for app.services.option_math — a Python port of
frontend/src/lib/optionMath.ts."""

from datetime import UTC, datetime

from app.services.option_math import (
    default_spot_fallback,
    nearest_strike_to,
    time_to_expiry,
)


class TestTimeToExpiry:
    def test_none_expiry_floors_to_minimum(self):
        assert time_to_expiry(None) == 0.0001

    def test_pegs_to_nse_close_and_floors_at_positive(self):
        at = datetime(2024, 1, 1, 9, 15, tzinfo=UTC)
        expiry = datetime(2024, 1, 1, 0, 0, tzinfo=UTC)  # same day, before close
        assert time_to_expiry(expiry, at) > 0

    def test_scales_with_days_remaining(self):
        at = datetime(2024, 1, 1, tzinfo=UTC)
        near = time_to_expiry(datetime(2024, 1, 8, tzinfo=UTC), at)
        far = time_to_expiry(datetime(2024, 6, 1, tzinfo=UTC), at)
        assert far > near

    def test_uses_extended_fno_close_from_cas_effective_date(self):
        pre_cas_at = datetime(2026, 7, 31, 10, 1, tzinfo=UTC)  # 15:31 IST
        post_cas_at = datetime(2026, 8, 3, 10, 1, tzinfo=UTC)  # 15:31 IST
        assert time_to_expiry(datetime(2026, 7, 31, tzinfo=UTC), pre_cas_at) == 0.0001
        assert time_to_expiry(datetime(2026, 8, 3, tzinfo=UTC), post_cas_at) > 0


class TestNearestStrikeTo:
    def test_empty_returns_target(self):
        assert nearest_strike_to([], 22000) == 22000

    def test_picks_closest(self):
        assert nearest_strike_to([21900, 22000, 22100], 22030) == 22000


class TestDefaultSpotFallback:
    def test_nifty(self):
        assert default_spot_fallback("NIFTY") == 22000.0

    def test_sensex(self):
        assert default_spot_fallback("SENSEX") == 80000.0

    def test_other_symbol(self):
        assert default_spot_fallback("RELIANCE") == 48000.0
