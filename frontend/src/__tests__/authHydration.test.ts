import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoginResponse } from "@/types/auth";

const authApi = vi.hoisted(() => ({
  autoLoginBroker: vi.fn(),
  loginWithBroker: vi.fn(),
  logoutUser: vi.fn(),
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the persisted session without waiting for broker reconnection", async () => {
    let resolveReconnect: (value: LoginResponse) => void = () => undefined;
    authApi.autoLoginBroker.mockReturnValue(new Promise<LoginResponse>((resolve) => {
      resolveReconnect = resolve;
    }));

    const { useAuthStore, isAuthHydrated } = await import("@/stores/authStore");
    useAuthStore.setState({ token: "persisted-token", user: response.user, isAuthenticated: false });

    await expect(useAuthStore.getState().hydrate()).resolves.toBeUndefined();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(isAuthHydrated()).toBe(true);

    resolveReconnect(response);
  });

  it("does not restore a session after the user logs out while reconnecting", async () => {
    let resolveReconnect: (value: LoginResponse) => void = () => undefined;
    authApi.autoLoginBroker.mockReturnValue(new Promise<LoginResponse>((resolve) => {
      resolveReconnect = resolve;
    }));

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
});
