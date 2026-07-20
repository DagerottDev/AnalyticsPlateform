"use client";

/**
 * LoginForm — Premium Fyers authentication form.
 *
 * Features:
 * - Tabbed selection: TOTP Auto-Login vs OAuth Redirect
 * - Dynamic credential fields & masks
 * - Step-by-step OAuth authorization code extraction and automated exchange
 * - Paper/Live trading mode toggle
 * - Connection verification with animated feedback
 * - Gradient border and glassmorphism styling
 *
 * Fyers is the only supported broker, and logging in replaces any existing
 * session — only one broker connection is active at a time.
 */

import { useState, useEffect, type FormEvent } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import type { TradingMode } from "@/types/auth";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Shield,
  ShieldCheck,
  Zap,
} from "lucide-react";

export function LoginForm() {
  const { login, isLoading, error, clearError } = useAuth();

  // Tabs: "totp" (headless auto-login) vs "oauth" (OAuth redirect wizard)
  const [loginType, setLoginType] = useState<"totp" | "oauth">("totp");

  const [appId, setAppId] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [tradingMode, setTradingMode] = useState<TradingMode>("paper");

  // TOTP auto-login fields
  const [clientId, setClientId] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [pin, setPin] = useState("");

  // OAuth wizard fields
  const [authCode, setAuthCode] = useState("");
  const [redirectUri, setRedirectUri] = useState("http://127.0.0.1:3001");

  // Toggles for masking secrets
  const [showApiSecret, setShowApiSecret] = useState(false);

  // Load from localStorage on mount (hydration safe)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedLoginType = localStorage.getItem("fy_login_type");
      if (savedLoginType) setLoginType(savedLoginType as "totp" | "oauth");

      setAppId(localStorage.getItem("fy_app_id") || "");
      setApiSecret(localStorage.getItem("fy_api_secret") || "");
      setClientId(localStorage.getItem("fy_client_id") || "");
      setTotpSecret(localStorage.getItem("fy_totp_secret") || "");
      setPin(localStorage.getItem("fy_pin") || "");
      setRedirectUri(localStorage.getItem("fy_redirect_uri") || "http://127.0.0.1:3001");

      const savedTradingMode = localStorage.getItem("fy_trading_mode");
      if (savedTradingMode) setTradingMode(savedTradingMode as TradingMode);
    }
  }, []);

  // Save to localStorage on change
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("fy_login_type", loginType);
      localStorage.setItem("fy_app_id", appId);
      localStorage.setItem("fy_api_secret", apiSecret);
      localStorage.setItem("fy_client_id", clientId);
      localStorage.setItem("fy_totp_secret", totpSecret);
      localStorage.setItem("fy_pin", pin);
      localStorage.setItem("fy_redirect_uri", redirectUri);
      localStorage.setItem("fy_trading_mode", tradingMode);
    }
  }, [loginType, appId, apiSecret, clientId, totpSecret, pin, redirectUri, tradingMode]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      if (loginType === "totp") {
        await login({
          app_id: appId,
          api_secret: apiSecret,
          redirect_uri: redirectUri,
          client_id: clientId,
          totp_secret: totpSecret,
          pin,
          trading_mode: tradingMode,
        });
      } else {
        await login({
          app_id: appId,
          api_secret: apiSecret,
          redirect_uri: redirectUri,
          auth_code: authCode,
          trading_mode: tradingMode,
        });
      }
    } catch {
      // Error is handled by the store
    }
  };

  const authUrl = `https://api-t1.fyers.in/api/v3/generate-authcode?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=private`;

  const isSubmitDisabled =
    isLoading ||
    !appId ||
    !apiSecret ||
    (loginType === "totp"
      ? !clientId || !totpSecret || !pin
      : !authCode);

  return (
    <div className="w-full max-w-md animate-fade-in">
      {/* Logo & Header */}
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--color-accent-blue)] to-[var(--color-accent-cyan)]">
          <Activity className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-[var(--color-text-bright)]">
          Option Analytics
        </h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          Connect your Fyers account to continue
        </p>
      </div>

      {/* Login Card */}
      <div className="gradient-border rounded-xl">
        <form
          onSubmit={handleSubmit}
          className="glass-strong space-y-5 rounded-xl p-6"
        >
          {/* Tab Selector */}
          <div className="flex gap-2 rounded-lg bg-[var(--color-bg-primary)] p-1">
            <button
              type="button"
              onClick={() => setLoginType("totp")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-all",
                loginType === "totp"
                  ? "bg-[var(--color-accent-blue)] text-white shadow-md"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              )}
            >
              <Zap className="h-3.5 w-3.5" />
              TOTP Auto-Login
            </button>
            <button
              type="button"
              onClick={() => setLoginType("oauth")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-all",
                loginType === "oauth"
                  ? "bg-[var(--color-accent-blue)] text-white shadow-md"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              )}
            >
              <KeyRound className="h-3.5 w-3.5" />
              OAuth Redirect
            </button>
          </div>

          {/* App ID */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
              Fyers App ID
            </label>
            <input
              type="text"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="e.g. XXXXXXXXX-100"
              required
              className="focus-ring w-full"
            />
          </div>

          {/* API Secret */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
              Fyers Secret Key
            </label>
            <div className="relative">
              <input
                type={showApiSecret ? "text" : "password"}
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="Enter Fyers Secret Key"
                required
                className="focus-ring w-full pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiSecret(!showApiSecret)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              >
                {showApiSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* TOTP AUTO-LOGIN FIELDS */}
          {loginType === "totp" && (
            <div className="space-y-4 animate-fade-in">
              {/* Client ID */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                  Fyers Client ID
                </label>
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Enter Fyers Client ID"
                  required
                  className="focus-ring w-full"
                />
              </div>

              {/* TOTP Secret */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                  TOTP Secret (2FA Key)
                </label>
                <input
                  type="text"
                  value={totpSecret}
                  onChange={(e) => setTotpSecret(e.target.value)}
                  placeholder="Enter TOTP setup secret"
                  required
                  className="focus-ring w-full"
                />
              </div>

              {/* Security PIN */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                  Fyers Security PIN
                </label>
                <input
                  type="password"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Enter 4-digit PIN"
                  required
                  className="focus-ring w-full font-mono text-center tracking-widest text-lg"
                />
              </div>
            </div>
          )}

          {/* OAUTH WIZARD FIELDS */}
          {loginType === "oauth" && (
            <div className="space-y-4 animate-fade-in">
              {/* Redirect URI */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                  Redirect URI
                </label>
                <input
                  type="text"
                  value={redirectUri}
                  onChange={(e) => setRedirectUri(e.target.value)}
                  placeholder="Enter registered Redirect URI"
                  required
                  className="focus-ring w-full"
                />
              </div>

              {/* Step 1: Open authorize page */}
              <div className="rounded-lg bg-[var(--color-bg-primary)]/40 p-3 border border-[var(--color-border)]/30 space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-accent-blue)]">
                  Step 1: Get Authorization
                </span>
                <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                  Log in on Fyers&apos; secure site and grant permissions.
                </p>
                <a
                  href={authUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "flex items-center justify-center gap-2 rounded px-3 py-2 text-xs font-semibold transition-all border",
                    !appId
                      ? "cursor-not-allowed border-[var(--color-border)] text-[var(--color-text-muted)] pointer-events-none"
                      : "border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/10 text-[var(--color-accent-blue)] hover:bg-[var(--color-accent-blue)] hover:text-white"
                  )}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Launch Fyers Login Page
                </a>
              </div>

              {/* Step 2: Paste redirect code */}
              <div className="rounded-lg bg-[var(--color-bg-primary)]/40 p-3 border border-[var(--color-border)]/30 space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-accent-cyan)]">
                  Step 2: Authenticate Code
                </span>
                <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                  Paste the redirected URL or the auth_code parameter.
                </p>
                <input
                  type="text"
                  value={authCode}
                  onChange={(e) => {
                    const val = e.target.value.trim();
                    // If they paste the entire URL, extract the code dynamically.
                    if (val.includes("auth_code=")) {
                      const codeMatch = val.match(/auth_code=([^&]+)/);
                      if (codeMatch) setAuthCode(codeMatch[1]);
                    } else {
                      setAuthCode(val);
                    }
                  }}
                  placeholder="Paste Fyers auth_code or Redirect URL"
                  required
                  className="focus-ring w-full text-xs"
                />
              </div>
            </div>
          )}

          {/* Trading Mode Toggle */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
              <Shield className="h-3.5 w-3.5" />
              Trading Mode
            </label>
            <div className="flex gap-2 rounded-lg bg-[var(--color-bg-primary)] p-1">
              <button
                type="button"
                onClick={() => setTradingMode("paper")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all",
                  tradingMode === "paper"
                    ? "bg-[var(--color-accent-blue)] text-white shadow-md"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                )}
              >
                <ShieldCheck className="h-4 w-4" />
                Paper
              </button>
              <button
                type="button"
                onClick={() => setTradingMode("live")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all",
                  tradingMode === "live"
                    ? "bg-[var(--color-accent-red)] text-white shadow-md"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                )}
              >
                <Zap className="h-4 w-4" />
                Live
              </button>
            </div>
            {tradingMode === "live" && (
              <p className="flex items-center gap-1.5 text-xs text-[var(--color-accent-orange)]">
                <AlertCircle className="h-3 w-3" />
                Live mode uses real funds. Trade carefully.
              </p>
            )}
          </div>

          {/* Error Message */}
          <ApiErrorDisplay error={error} />

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitDisabled}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white transition-all duration-200",
              isSubmitDisabled
                ? "cursor-not-allowed bg-[var(--color-bg-surface)] text-[var(--color-text-muted)]"
                : "bg-gradient-to-r from-[var(--color-accent-blue)] to-[var(--color-accent-cyan)] shadow-lg hover:shadow-[var(--shadow-glow-blue)] hover:brightness-110 active:scale-[0.98]"
            )}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Connecting to Fyers...
              </>
            ) : loginType === "oauth" ? (
              <>
                Authenticate & Connect
                <ArrowRight className="h-4 w-4 ml-1" />
              </>
            ) : (
              <>
                <Activity className="h-4 w-4" />
                Automate & Login
              </>
            )}
          </button>
        </form>
      </div>

      {/* Footer */}
      <p className="mt-6 text-center text-xs text-[var(--color-text-muted)]">
        Secured directly by the Fyers API
      </p>
    </div>
  );
}
