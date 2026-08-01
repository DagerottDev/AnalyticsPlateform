"""Shared IV Rank / IV Percentile math, used by both the single-symbol
volatility endpoints and the F&O universe screener."""


def iv_rank(values: list[float], current: float) -> float:
    """(current - min) / (max - min) * 100, over the given historical values."""
    low = min(values)
    high = max(values)
    return ((current - low) / (high - low)) * 100 if high > low else 0.0


def iv_percentile(values: list[float], current: float) -> float:
    """Percentage of historical values strictly below the current value."""
    days_below = sum(1 for value in values if value < current)
    return (days_below / len(values)) * 100
