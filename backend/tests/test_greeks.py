"""Tests for the server-side Black-Scholes Greeks/IV engine — a Python port
of frontend/src/lib/greeks.ts (see frontend/src/__tests__/greeks.test.ts,
which this file mirrors so the two engines stay verifiably in sync).
"""

import pytest
from httpx import AsyncClient

from app.services.greeks import calculate_greeks, calculate_implied_volatility, norm_cdf


class TestNormCDF:
    def test_known_values(self):
        assert norm_cdf(0) == pytest.approx(0.5, abs=1e-4)
        assert norm_cdf(1.96) == pytest.approx(0.975, abs=1e-3)
        assert norm_cdf(-1.96) == pytest.approx(0.025, abs=1e-3)


class TestCalculateGreeks:
    def test_call_price_and_primary_greeks(self):
        # S=100, K=100, T=1 (1 year), r=0.05, v=0.20
        # Known values for these inputs:
        # d1 = (ln(1) + (0.05 + 0.02)*1) / 0.2 = 0.07 / 0.2 = 0.35
        # d2 = 0.35 - 0.2 = 0.15
        # N(d1) ~ 0.6368
        # Price ~ 10.4506
        res = calculate_greeks("CE", 100, 100, 1, 0.05, 0.20)
        assert res.price == pytest.approx(10.45, abs=0.1)
        assert res.delta == pytest.approx(0.6368, abs=0.01)
        assert res.gamma == pytest.approx(0.0188, abs=0.001)

    def test_put_delta(self):
        # Put delta = Call delta - 1 = 0.6368 - 1 = -0.3632
        res = calculate_greeks("PE", 100, 100, 1, 0.05, 0.20)
        assert res.delta == pytest.approx(-0.3632, abs=0.01)


class TestImpliedVolatility:
    def test_recovers_known_volatility(self):
        # IV for the exact price computed above should round-trip back to 0.20
        known_price = 10.45058
        iv = calculate_implied_volatility("CE", 100, 100, 1, 0.05, known_price)
        assert iv == pytest.approx(0.20, abs=1e-3)

    def test_handles_intrinsic_boundary(self):
        # S=100, K=90. Intrinsic is 10. Market price 9 is below intrinsic —
        # an arbitrage condition, so IV should come back at/near zero.
        iv = calculate_implied_volatility("CE", 100, 90, 1, 0.05, 9)
        assert iv < 0.01


class TestHigherOrderGreeksFiniteDifference:
    """Rather than hardcode reference numbers (easy to get subtly wrong by
    hand), each analytic formula is checked against a central finite
    difference of the relevant lower-order Greek — a self-verifying
    property that holds regardless of the specific S/K/T/r/sigma chosen.
    """

    S, K, T, r, sigma = 100, 95, 0.5, 0.05, 0.25
    eps = 1e-4

    def test_vanna_and_charm_identical_for_ce_and_pe(self):
        ce = calculate_greeks("CE", self.S, self.K, self.T, self.r, self.sigma)
        pe = calculate_greeks("PE", self.S, self.K, self.T, self.r, self.sigma)
        assert ce.vanna == pytest.approx(pe.vanna, abs=1e-8)
        assert ce.charm == pytest.approx(pe.charm, abs=1e-8)
        assert ce.speed == pytest.approx(pe.speed, abs=1e-8)
        assert ce.zomma == pytest.approx(pe.zomma, abs=1e-8)
        assert ce.vomma == pytest.approx(pe.vomma, abs=1e-8)
        assert ce.color == pytest.approx(pe.color, abs=1e-8)
        assert ce.ultima == pytest.approx(pe.ultima, abs=1e-8)

    def test_vanna_matches_finite_difference_of_delta(self):
        up = calculate_greeks("CE", self.S, self.K, self.T, self.r, self.sigma + self.eps).delta
        down = calculate_greeks("CE", self.S, self.K, self.T, self.r, self.sigma - self.eps).delta
        fd = (up - down) / (2 * self.eps) / 100  # /100: per-1%-vol scaling
        vanna = calculate_greeks("CE", self.S, self.K, self.T, self.r, self.sigma).vanna
        assert vanna == pytest.approx(fd, abs=1e-4)

    def test_vomma_matches_finite_difference_of_vega(self):
        up = calculate_greeks("CE", self.S, self.K, self.T, self.r, self.sigma + self.eps).vega
        down = calculate_greeks("CE", self.S, self.K, self.T, self.r, self.sigma - self.eps).vega
        fd = (up - down) / (2 * self.eps)
        vomma = calculate_greeks("CE", self.S, self.K, self.T, self.r, self.sigma).vomma
        assert vomma == pytest.approx(fd, abs=1e-4)

    def test_charm_matches_finite_difference_of_delta_over_time(self):
        up = calculate_greeks("CE", self.S, self.K, self.T + self.eps, self.r, self.sigma).delta
        down = calculate_greeks("CE", self.S, self.K, self.T - self.eps, self.r, self.sigma).delta
        fd = -((up - down) / (2 * self.eps)) / 365
        charm = calculate_greeks("CE", self.S, self.K, self.T, self.r, self.sigma).charm
        assert charm == pytest.approx(fd, abs=1e-4)

    def test_speed_matches_finite_difference_of_gamma(self):
        up = calculate_greeks("CE", self.S + self.eps, self.K, self.T, self.r, self.sigma).gamma
        down = calculate_greeks("CE", self.S - self.eps, self.K, self.T, self.r, self.sigma).gamma
        fd = (up - down) / (2 * self.eps)
        speed = calculate_greeks("CE", self.S, self.K, self.T, self.r, self.sigma).speed
        assert speed == pytest.approx(fd, abs=1e-4)

    def test_zomma_matches_finite_difference_of_gamma_over_vol(self):
        up = calculate_greeks("CE", self.S, self.K, self.T, self.r, self.sigma + self.eps).gamma
        down = calculate_greeks("CE", self.S, self.K, self.T, self.r, self.sigma - self.eps).gamma
        fd = (up - down) / (2 * self.eps)
        zomma = calculate_greeks("CE", self.S, self.K, self.T, self.r, self.sigma).zomma
        assert zomma == pytest.approx(fd, abs=1e-4)

    def test_color_matches_finite_difference_of_gamma_over_time(self):
        up = calculate_greeks("CE", self.S, self.K, self.T + self.eps, self.r, self.sigma).gamma
        down = calculate_greeks("CE", self.S, self.K, self.T - self.eps, self.r, self.sigma).gamma
        fd = -((up - down) / (2 * self.eps)) / 365
        color = calculate_greeks("CE", self.S, self.K, self.T, self.r, self.sigma).color
        assert color == pytest.approx(fd, abs=1e-4)

    def test_ultima_matches_finite_difference_of_vomma(self):
        up = calculate_greeks("CE", self.S, self.K, self.T, self.r, self.sigma + self.eps).vomma
        down = calculate_greeks("CE", self.S, self.K, self.T, self.r, self.sigma - self.eps).vomma
        fd = (up - down) / (2 * self.eps)
        ultima = calculate_greeks("CE", self.S, self.K, self.T, self.r, self.sigma).ultima
        assert ultima == pytest.approx(fd, abs=1e-3)


class TestGreeksRouter:
    @pytest.mark.asyncio
    async def test_price_endpoint(self, client: AsyncClient, access_token: str):
        headers = {"Authorization": f"Bearer {access_token}"}
        payload = {
            "option_type": "CE", "spot": 100, "strike": 100,
            "time_to_expiry": 1, "volatility": 0.20, "risk_free_rate": 0.05,
        }
        response = await client.post("/api/v1/greeks/price", json=payload, headers=headers)
        assert response.status_code == 200
        assert response.json()["price"] == pytest.approx(10.45, abs=0.1)

    @pytest.mark.asyncio
    async def test_greeks_endpoint(self, client: AsyncClient, access_token: str):
        headers = {"Authorization": f"Bearer {access_token}"}
        payload = {
            "option_type": "CE", "spot": 100, "strike": 100,
            "time_to_expiry": 1, "volatility": 0.20, "risk_free_rate": 0.05,
        }
        response = await client.post("/api/v1/greeks", json=payload, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["delta"] == pytest.approx(0.6368, abs=0.01)
        assert set(data.keys()) == {
            "price", "delta", "gamma", "theta", "vega", "rho",
            "vanna", "vomma", "charm", "speed", "color", "zomma", "ultima",
        }

    @pytest.mark.asyncio
    async def test_implied_volatility_endpoint(self, client: AsyncClient, access_token: str):
        headers = {"Authorization": f"Bearer {access_token}"}
        payload = {
            "option_type": "CE", "spot": 100, "strike": 100,
            "time_to_expiry": 1, "market_price": 10.45058, "risk_free_rate": 0.05,
        }
        response = await client.post(
            "/api/v1/greeks/implied-volatility", json=payload, headers=headers
        )
        assert response.status_code == 200
        assert response.json()["implied_volatility"] == pytest.approx(0.20, abs=1e-3)

    @pytest.mark.asyncio
    async def test_requires_auth(self, client: AsyncClient):
        payload = {
            "option_type": "CE", "spot": 100, "strike": 100,
            "time_to_expiry": 1, "volatility": 0.20,
        }
        response = await client.post("/api/v1/greeks", json=payload)
        assert response.status_code == 403
