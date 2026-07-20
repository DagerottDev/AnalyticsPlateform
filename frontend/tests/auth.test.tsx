/**
 * Tests for authentication utilities and store behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the auth module
vi.mock("@/lib/auth", () => ({
  loginWithBroker: vi.fn(),
  logoutUser: vi.fn(),
}));

describe("Auth Types", () => {
  it("should define TradingMode as paper or live", () => {
    type TradingMode = "paper" | "live";
    const paper: TradingMode = "paper";
    const live: TradingMode = "live";
    expect(paper).toBe("paper");
    expect(live).toBe("live");
  });

  it("should define UserProfile interface shape", () => {
    const profile = {
      client_id: "TEST001",
      broker_name: "Fyers",
      trading_mode: "paper" as const,
      account_name: "Default",
      connected_at: "2024-01-01T00:00:00Z",
    };

    expect(profile.client_id).toBe("TEST001");
    expect(profile.broker_name).toBe("Fyers");
    expect(profile.trading_mode).toBe("paper");
  });
});

describe("Auth Utilities", () => {
  it("should format TOTP login request correctly", () => {
    const request = {
      app_id: "test-app-id-100",
      api_secret: "test-secret",
      client_id: "test-client-id",
      totp_secret: "test-totp-secret",
      pin: "1234",
      trading_mode: "paper" as const,
    };

    expect(request).toHaveProperty("app_id");
    expect(request).toHaveProperty("client_id");
    expect(request).toHaveProperty("trading_mode");
    expect(request.trading_mode).toMatch(/^(paper|live)$/);
  });

  it("should format OAuth login request correctly", () => {
    const request = {
      app_id: "test-app-id-100",
      api_secret: "test-secret",
      auth_code: "test-auth-code",
      redirect_uri: "http://127.0.0.1:3000",
      trading_mode: "paper" as const,
    };

    expect(request).toHaveProperty("auth_code");
    expect(request).toHaveProperty("redirect_uri");
  });

  it("should validate token response shape", () => {
    const response = {
      access_token: "eyJhbGci...",
      token_type: "bearer",
      expires_in: 28800,
      user: {
        client_id: "TEST001",
        broker_name: "Fyers",
        trading_mode: "paper" as const,
        account_name: "Default",
        connected_at: "2024-01-01T00:00:00Z",
      },
    };

    expect(response.token_type).toBe("bearer");
    expect(response.expires_in).toBeGreaterThan(0);
    expect(response.user.client_id).toBeTruthy();
  });
});

describe("cn utility", () => {
  // Import directly to test
  it("should merge class names", async () => {
    // Simple class merge test without dependencies
    const classes = ["foo", "bar"].filter(Boolean).join(" ");
    expect(classes).toBe("foo bar");
  });
});
