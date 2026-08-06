import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/auth/LoginForm";
import { SAVED_LOGIN_KEYS } from "@/lib/auth";

const authMock = vi.hoisted(() => ({
  login: vi.fn(),
  isLoading: false,
  error: null,
  clearError: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authMock,
}));

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  };
}

describe("LoginForm credential persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    localStorage.setItem(SAVED_LOGIN_KEYS.loginType, "totp");
    localStorage.setItem(SAVED_LOGIN_KEYS.broker, "fyers");
    localStorage.setItem(SAVED_LOGIN_KEYS.appId, "saved-app-id-100");
    localStorage.setItem(SAVED_LOGIN_KEYS.apiSecret, "saved-secret");
    localStorage.setItem(SAVED_LOGIN_KEYS.clientId, "saved-client");
    localStorage.setItem(SAVED_LOGIN_KEYS.totpSecret, "saved-totp");
    localStorage.setItem(SAVED_LOGIN_KEYS.pin, "1234");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not overwrite saved credentials during the initial hydration", async () => {
    render(<LoginForm />);

    await waitFor(() => {
      expect(
        (screen.getByPlaceholderText("e.g. XXXXXXXXX-100") as HTMLInputElement).value,
      ).toBe("saved-app-id-100");
    });

    expect(localStorage.getItem(SAVED_LOGIN_KEYS.appId)).toBe("saved-app-id-100");
    expect(localStorage.getItem(SAVED_LOGIN_KEYS.apiSecret)).toBe("saved-secret");
    expect(localStorage.getItem(SAVED_LOGIN_KEYS.clientId)).toBe("saved-client");
    expect(localStorage.getItem(SAVED_LOGIN_KEYS.totpSecret)).toBe("saved-totp");
    expect(localStorage.getItem(SAVED_LOGIN_KEYS.pin)).toBe("1234");
  });
});
