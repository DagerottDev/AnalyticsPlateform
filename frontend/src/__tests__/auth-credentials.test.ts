import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getSavedLoginCredentials,
  hasSavedTotpCredentials,
  clearSavedLoginCredentials,
  SAVED_LOGIN_KEYS,
} from "../lib/auth";

/**
 * Node 22+'s own experimental global `localStorage` shadows jsdom's
 * implementation in this environment and throws without a backing file
 * configured, so a minimal in-memory stub is provided directly rather than
 * relying on whichever `localStorage` happens to be installed globally.
 */
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

describe("saved login credentials (localStorage helpers)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns empty-string defaults and paper mode when nothing is saved", () => {
    const creds = getSavedLoginCredentials();
    expect(creds).toEqual({
      appId: "",
      apiSecret: "",
      clientId: "",
      totpSecret: "",
      pin: "",
      redirectUri: "http://127.0.0.1:3000",
      tradingMode: "paper",
    });
  });

  it("reads back whatever was saved", () => {
    localStorage.setItem(SAVED_LOGIN_KEYS.appId, "test-app-id-100");
    localStorage.setItem(SAVED_LOGIN_KEYS.apiSecret, "test-secret");
    localStorage.setItem(SAVED_LOGIN_KEYS.clientId, "YR02352");
    localStorage.setItem(SAVED_LOGIN_KEYS.totpSecret, "totp-secret");
    localStorage.setItem(SAVED_LOGIN_KEYS.pin, "1234");
    localStorage.setItem(SAVED_LOGIN_KEYS.tradingMode, "live");

    const creds = getSavedLoginCredentials();
    expect(creds?.appId).toBe("test-app-id-100");
    expect(creds?.clientId).toBe("YR02352");
    expect(creds?.tradingMode).toBe("live");
  });

  it("hasSavedTotpCredentials is false until all five TOTP fields are present", () => {
    expect(hasSavedTotpCredentials()).toBe(false);

    localStorage.setItem(SAVED_LOGIN_KEYS.appId, "a");
    localStorage.setItem(SAVED_LOGIN_KEYS.apiSecret, "b");
    localStorage.setItem(SAVED_LOGIN_KEYS.clientId, "c");
    localStorage.setItem(SAVED_LOGIN_KEYS.totpSecret, "d");
    expect(hasSavedTotpCredentials()).toBe(false); // pin still missing

    localStorage.setItem(SAVED_LOGIN_KEYS.pin, "1234");
    expect(hasSavedTotpCredentials()).toBe(true);
  });

  it("clearSavedLoginCredentials removes every saved key", () => {
    Object.values(SAVED_LOGIN_KEYS).forEach((key) => localStorage.setItem(key, "x"));
    clearSavedLoginCredentials();
    Object.values(SAVED_LOGIN_KEYS).forEach((key) => expect(localStorage.getItem(key)).toBeNull());
  });
});
