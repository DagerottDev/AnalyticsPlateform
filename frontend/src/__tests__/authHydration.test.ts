import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoginResponse } from "@/types/auth";

const authApi = vi.hoisted(() => ({
  autoLoginBroker: vi.fn(),
  loginWithBroker: vi.fn(),
  logoutUser: vi.fn(),
  verifyBrokerSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => authApi);

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
  };
}

const response: LoginResponse = {
  access_token: "fresh-token",
  token_type: "bearer",
  expires_in: 28_800,
  user: {
    client_id: "test-client",
    broker_name: "fyers",
    trading_mode: "paper",
    account_name: "Test account",
    connected_at: "2026-08-01T00:00:00Z",
  },
};

describe("authentication hydration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", createMemoryStorage());
    authApi.autoLoginBroker.mockReset();
    authApi.loginWithBroker.mockReset();
    authApi.logoutUser.mockReset();
    authApi.verifyBrokerSession.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses a verified persisted broker session without auto-login", async () => {
    authApi.verifyBrokerSession.mockResolvedValue(undefined);

    const { useAuthStore, isAuthHydrated } = await import("@/stores/authStore");
    useAuthStore.setState({ token: "persisted-token", user: response.user, isAuthenticated: false });

    await expect(useAuthStore.getState().hydrate()).resolves.toBeUndefined();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(isAuthHydrated()).toBe(true);
    await Promise.resolve();
    expect(authApi.verifyBrokerSession).toHaveBeenCalledOnce();
    expect(authApi.autoLoginBroker).not.toHaveBeenCalled();
    expect(useAuthStore.getState().token).toBe("persisted-token");
  });

  it("does not restore a session after the user logs out while reconnecting", async () => {
    let resolveReconnect: (value: LoginResponse) => void = () => undefined;
    authApi.autoLoginBroker.mockReturnValue(new Promise<LoginResponse>((resolve) => {
      resolveReconnect = resolve;
    }));
    authApi.verifyBrokerSession.mockRejectedValue({ response: { status: 401, data: { detail: "Active broker session not found" } } });

    const { useAuthStore } = await import("@/stores/authStore");
    useAuthStore.setState({ token: "persisted-token", user: response.user, isAuthenticated: false });
    await useAuthStore.getState().hydrate();
    useAuthStore.getState().logout();
    resolveReconnect(response);
    await Promise.resolve();
    await Promise.resolve();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().token).toBeNull();
  });

  it("does not probe saved broker credentials without a browser session", async () => {
    const { useAuthStore } = await import("@/stores/authStore");
    await useAuthStore.getState().hydrate();
    expect(authApi.autoLoginBroker).not.toHaveBeenCalled();
    expect(authApi.verifyBrokerSession).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it("does not renew an expired JWT from saved broker credentials", async () => {
    authApi.verifyBrokerSession.mockRejectedValue({ response: { status: 401,
      data: { detail: "Invalid or expired token: Signature has expired." } } });
    const { useAuthStore } = await import("@/stores/authStore");
    useAuthStore.setState({ token: "expired-token", user: response.user });
    await useAuthStore.getState().hydrate();
    await Promise.resolve();
    expect(authApi.autoLoginBroker).not.toHaveBeenCalled();
  });
});
