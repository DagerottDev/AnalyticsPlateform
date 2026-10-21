import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoginResponse } from "@/types/auth";

const auth = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  setState: vi.fn(),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: { getState: () => auth.state, setState: auth.setState },
}));

const recovered: LoginResponse = {
  access_token: "recovered-token", token_type: "bearer", expires_in: 480,
  user: { client_id: "owner", broker_name: "Fyers", trading_mode: "paper",
    account_name: "Test", connected_at: "2026-10-21T00:00:00Z" },
};

describe("account-bound API recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.state = { token: "original-token", user: recovered.user,
      isAuthenticated: true, isLoading: false, sessionLive: true };
    auth.setState.mockReset().mockImplementation((update) => Object.assign(auth.state, update));
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify({ state: { token: auth.state.token } }),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  async function setup(detail = "Active broker session not found") {
    const { apiClient } = await import("@/lib/api");
    const requests: InternalAxiosRequestConfig[] = [];
    let finish: (result: LoginResponse) => void = () => undefined;
    const recovery = new Promise<LoginResponse>((resolve) => { finish = resolve; });
    apiClient.defaults.adapter = async (config) => {
      requests.push(config);
      if (config.url === "/auth/auto-login") {
        return { data: await recovery, status: 200, statusText: "OK", headers: {}, config };
      }
      if (config.headers.Authorization === "Bearer recovered-token") {
        return { data: { ok: true }, status: 200, statusText: "OK", headers: {}, config };
      }
      throw new AxiosError("missing session", "ERR_BAD_REQUEST", config, undefined, {
        data: { detail }, status: 401, statusText: "Unauthorized", headers: {}, config,
      });
    };
    return { apiClient, requests, finish };
  }

  it("recovers once with the initiating token and retries under the same identity", async () => {
    const { apiClient, requests, finish } = await setup();
    const pending = apiClient.post("/orders", { symbol: "fixture" });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].headers.Authorization).toBe("Bearer original-token");
    finish(recovered);
    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(requests).toHaveLength(3);
    expect(requests[2].headers.Authorization).toBe("Bearer recovered-token");
    expect(auth.state.token).toBe("recovered-token");
  });

  it.each(["logout", "account switch", "new login"])(
    "does not overwrite or replay a mutation after %s", async (change) => {
      const { apiClient, requests, finish } = await setup();
      const outcome = apiClient.post("/orders", {}).catch((error: unknown) => error);
      await vi.waitFor(() => expect(requests).toHaveLength(2));
      if (change === "logout") Object.assign(auth.state, { token: null, isAuthenticated: false });
      if (change === "account switch") Object.assign(auth.state, { token: "other-token",
        user: { ...recovered.user, client_id: "other" } });
      if (change === "new login") auth.state.isLoading = true;
      finish(recovered);
      expect(axios.isAxiosError(await outcome)).toBe(true);
      expect(requests).toHaveLength(2);
      expect(auth.setState).not.toHaveBeenCalled();
    },
  );

  it("rejects a recovery response for another identity", async () => {
    const { apiClient, requests, finish } = await setup();
    const outcome = apiClient.post("/orders", {}).catch((error: unknown) => error);
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    finish({ ...recovered, user: { ...recovered.user, client_id: "other" } });
    expect(axios.isAxiosError(await outcome)).toBe(true);
    expect(requests).toHaveLength(2);
    expect(auth.setState).not.toHaveBeenCalled();
  });

  it("does not attempt recovery for expired JWTs", async () => {
    const { apiClient, requests } = await setup("Invalid or expired token: Signature has expired.");
    await expect(apiClient.get("/orders")).rejects.toBeInstanceOf(AxiosError);
    expect(requests).toHaveLength(1);
  });

  it("keeps the logout credential after the local session is cleared", async () => {
    const { apiClient, requests } = await setup();
    apiClient.defaults.adapter = async (config) => {
      requests.push(config);
      return { data: {}, status: 200, statusText: "OK", headers: {}, config };
    };
    const { logoutUser } = await import("@/lib/auth");
    const pending = logoutUser("original-token");
    auth.state.token = null;
    await pending;
    expect(requests[0].headers.Authorization).toBe("Bearer original-token");
  });
});
