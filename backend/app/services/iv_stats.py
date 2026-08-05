"""Shared IV Rank / IV Percentile math, used by both the single-symbol
volatility endpoints and the F&O universe screener."""

MIN_IV_HISTORY_OBSERVATIONS = 20


def iv_rank(values: list[float], current: float) -> float:
    """Return current IV's bounded rank against prior observations.

    ``values`` must contain observations *before* ``current``. Keeping the
    current observation out of the sample is important for IV percentile and
    avoids a newly observed extreme changing the denominator.
    """
    if not values:
        return 0.0
    low = min(values)
    high = max(values)
    if high <= low:
        return 100.0 if current > high else 0.0
    return max(0.0, min(100.0, ((current - low) / (high - low)) * 100))


def iv_percentile(values: list[float], current: float) -> float:
    """Percentage of prior IV observations strictly below the current value."""
    if not values:
        return 0.0
    days_below = sum(1 for value in values if value < current)
    return (days_below / len(values)) * 100
