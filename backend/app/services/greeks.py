"""Black-Scholes option pricing, Greeks, and implied-volatility solver.

Direct port of frontend/src/lib/greeks.ts — keep the two in sync. Nothing
server-side could evaluate Greeks before this; alerts, backfill jobs, and
execution logic all need it.

One deliberate deviation from the TS original: normal CDF here uses
`math.erf` (exact, via the standard erf-to-Phi identity) rather than
porting Hastings' polynomial approximation — Python has no built-in
Hastings approximation, and `erf` is both simpler and strictly more
accurate, well within the tolerances the ported test suite checks against.
"""

import math
from dataclasses import dataclass

from app.services.option_math import OptionType


@dataclass(frozen=True)
class Greeks:
    price: float
    delta: float
    gamma: float
    theta: float
    vega: float
    rho: float
    # Second/third-order Greeks. Vanna/vomma/charm/speed/zomma/ultima are
    # mathematically identical for CE and PE under Black-Scholes (they're
    # derivatives of d1/d2, and delta_PE = delta_CE - 1 is a constant
    # offset, so its higher-order derivatives match the call's exactly).
    vanna: float
    vomma: float
    charm: float
    speed: float
    color: float
    zomma: float
    ultima: float


def norm_cdf(x: float) -> float:
    """Standard normal CDF."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2)))


def _norm_pdf(x: float) -> float:
    return (1 / math.sqrt(2 * math.pi)) * math.exp(-0.5 * x * x)


def calculate_option_price(
    option_type: OptionType,
    S: float,  # Spot price
    K: float,  # Strike price
    T: float,  # Time to expiry in years
    r: float,  # Risk-free interest rate (e.g. 0.10)
    sigma: float,  # Volatility (decimal, e.g. 0.15)
) -> float:
    if T <= 0:
        return max(0.0, S - K) if option_type == "CE" else max(0.0, K - S)
    if sigma <= 0:
        if option_type == "CE":
            return max(0.0, S - K * math.exp(-r * T))
        return max(0.0, K * math.exp(-r * T) - S)

    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)

    if option_type == "CE":
        return S * norm_cdf(d1) - K * math.exp(-r * T) * norm_cdf(d2)
    return K * math.exp(-r * T) * norm_cdf(-d2) - S * norm_cdf(-d1)


def calculate_greeks(
    option_type: OptionType, S: float, K: float, T: float, r: float, sigma: float
) -> Greeks:
    price = calculate_option_price(option_type, S, K, T, r, sigma)

    if T <= 0 or sigma <= 0:
        delta = (1.0 if S > K else 0.0) if option_type == "CE" else (-1.0 if S < K else 0.0)
        return Greeks(
            price=price, delta=delta, gamma=0, theta=0, vega=0, rho=0,
            vanna=0, vomma=0, charm=0, speed=0, color=0, zomma=0, ultima=0,
        )

    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)

    # Delta
    delta = norm_cdf(d1) if option_type == "CE" else norm_cdf(d1) - 1

    # Gamma (same for CE/PE)
    gamma = _norm_pdf(d1) / (S * sigma * math.sqrt(T))

    # Vega (same for CE/PE) - scaled for 1% change in vol
    vega = (S * _norm_pdf(d1) * math.sqrt(T)) / 100

    # Theta - scaled for 1 day change
    theta1 = -(S * _norm_pdf(d1) * sigma) / (2 * math.sqrt(T))
    if option_type == "CE":
        theta2 = r * K * math.exp(-r * T) * norm_cdf(d2)
        theta = (theta1 - theta2) / 365
    else:
        theta2 = r * K * math.exp(-r * T) * norm_cdf(-d2)
        theta = (theta1 + theta2) / 365

    # Rho - scaled for 1% change in rates
    if option_type == "CE":
        rho = (K * T * math.exp(-r * T) * norm_cdf(d2)) / 100
    else:
        rho = (-K * T * math.exp(-r * T) * norm_cdf(-d2)) / 100

    # Second/third-order Greeks. Identical for CE/PE under Black-Scholes
    # (see the Greeks dataclass comment). Scaling mirrors the first-order
    # Greeks above: vega/vanna/vomma/ultima are "per 1% vol move" (/100),
    # theta/charm/color are "per 1 day" (/365), gamma/speed/zomma are raw
    # (unscaled, matching gamma's own convention).
    sqrt_t = math.sqrt(T)
    vega_raw = S * _norm_pdf(d1) * sqrt_t  # unscaled vega (d(price)/d(sigma))

    # Vanna = d(delta)/d(sigma) = d(vega)/d(S)
    vanna = (-_norm_pdf(d1) * (d2 / sigma)) / 100

    # Vomma (volga) = d(vega)/d(sigma)
    vomma = (vega_raw * ((d1 * d2) / sigma)) / 100

    # Charm = -d(delta)/d(T) — the minus sign expresses decay as time
    # passes (T counts down to expiry), matching theta's sign convention.
    charm_raw = -_norm_pdf(d1) * ((2 * r * T - d2 * sigma * sqrt_t) / (2 * T * sigma * sqrt_t))
    charm = charm_raw / 365

    # Speed = d(gamma)/d(S)
    speed = (-gamma / S) * (d1 / (sigma * sqrt_t) + 1)

    # Color = -d(gamma)/d(T), same day-decay sign convention as charm.
    color_raw = (-_norm_pdf(d1) / (2 * S * T * sigma * sqrt_t)) * (
        2 * r * T + 1 + (d1 * (2 * r * T - d2 * sigma * sqrt_t)) / (sigma * sqrt_t)
    )
    color = -color_raw / 365

    # Zomma = d(gamma)/d(sigma)
    zomma = (gamma * (d1 * d2 - 1)) / sigma

    # Ultima = d(vomma)/d(sigma)
    ultima_raw = (-vega_raw / (sigma * sigma)) * (
        d1 * d2 * (1 - d1 * d2) + d1 * d1 + d2 * d2
    )
    ultima = ultima_raw / 100

    return Greeks(
        price=price, delta=delta, gamma=gamma, theta=theta, vega=vega, rho=rho,
        vanna=vanna, vomma=vomma, charm=charm, speed=speed, color=color,
        zomma=zomma, ultima=ultima,
    )


def calculate_implied_volatility(
    option_type: OptionType, S: float, K: float, T: float, r: float, market_price: float
) -> float:
    """Implied volatility via Newton-Raphson with bisection fallback."""
    max_iterations = 100
    precision = 1e-5
    sigma = 0.3  # starting guess (30% IV)

    # Quick sanity check
    intrinsic = max(0.0, S - K) if option_type == "CE" else max(0.0, K - S)
    if market_price <= intrinsic:
        return 0.0  # Out of bounds / arbitrage condition

    for _ in range(max_iterations):
        price = calculate_option_price(option_type, S, K, T, r, sigma)
        diff = price - market_price

        if abs(diff) < precision:
            return sigma

        greeks = calculate_greeks(option_type, S, K, T, r, sigma)
        vega = greeks.vega * 100  # un-scale it

        if abs(vega) < 1e-4:
            break

        next_sigma = sigma - diff / vega
        if next_sigma <= 0 or next_sigma > 5.0:
            break
        sigma = next_sigma

    # Bisection fallback
    low, high, mid = 1e-4, 5.0, 0.3
    for _ in range(max_iterations):
        mid = (low + high) / 2
        price = calculate_option_price(option_type, S, K, T, r, mid)
        diff = price - market_price

        if abs(diff) < precision:
            return mid

        if diff > 0:
            high = mid
        else:
            low = mid

    return mid
