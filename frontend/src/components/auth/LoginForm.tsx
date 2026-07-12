"use client";

/**
 * LoginForm — Premium native broker authentication form.
 *
 * Features:
 * - Tabbed selection: Quick Login (TOTP Auto Login) & Manual Login (Access Token)
 * - Sub-selection under Manual Login: Paste Token Directly vs OAuth Helper Wizard
 * - Broker selection (Fyers / Zerodha)
 * - Dynamic credential fields & masks
 * - Step-by-Step OAuth authorization code extraction and automated exchange
 * - Paper/Live trading mode toggle
 * - Connection verification with animated feedback
 * - Gradient border and glassmorphism styling
 */

import { useState, type FormEvent } from "react";
import { useAuth } from "@/hooks/useAuth";
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
  Server,
  Shield,
  ShieldCheck,
  Zap,
} from "lucide-react";

export function LoginForm() {
  const { login, autoLogin, exchangeCode, isLoading, error, clearError } = useAuth();
  
  // Tabs: "totp" (Auto login) vs "manual" (Access Token)
  const [loginType, setLoginType] = useState<"totp" | "manual">("totp");
  
  // Sub-tabs under Manual: "paste" (Direct Token) vs "wizard" (Interactive OAuth helper)
  const [manualMode, setManualMode] = useState<"paste" | "wizard">("paste");
  
  const [brokerName, setBrokerName] = useState<"fyers" | "zerodha">("zerodha");
  const [appId, setAppId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [tradingMode, setTradingMode] = useState<TradingMode>("paper");
  
  // Auto Login Fields
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [pin, setPin] = useState(""); // Fyers PIN
  
  // Wizard Helper Fields
  const [authCode, setAuthCode] = useState("");
  const [redirectUri, setRedirectUri] = useState("http://127.0.0.1:3001");
  
  // Toggles for masking passwords
  const [showToken, setShowToken] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showApiSecret, setShowApiSecret] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      if (loginType === "totp") {
        await autoLogin(
          brokerName,
          userId,
          brokerName === "fyers" ? undefined : password,
          totpSecret,
          apiKey,
          apiSecret,
          tradingMode,
          brokerName === "fyers" ? pin : undefined
        );
      } else if (loginType === "manual" && manualMode === "wizard") {
        await exchangeCode(
          brokerName,
          authCode,
          apiKey,
          apiSecret,
          redirectUri,
          tradingMode
        );
      } else {
        await login(brokerName, appId, apiKey, accessToken, tradingMode);
      }
    } catch {
      // Error is handled by the store
    }
  };

  const getAuthUrl = () => {
    if (brokerName === "fyers") {
      // Fyers authorize url (requires appId, redirect_uri, response_type=code)
      return `https://api.fyers.in/api/v2/generate-authcode?client_id=${apiKey}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=private`;
    } else {
      // Zerodha authorize url
      return `https://kite.zerodha.com/connect/login?api_key=${apiKey}&v=3`;
    }
  };

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
          Connect to your broker directly
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
              onClick={() => {
                setLoginType("totp");
              }}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-all",
                loginType === "totp"
                  ? "bg-[var(--color-accent-blue)] text-white shadow-md"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              )}
            >
              <Zap className="h-3.5 w-3.5" />
              Quick (TOTP)
            </button>
            <button
              type="button"
              onClick={() => setLoginType("manual")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-all",
                loginType === "manual"
                  ? "bg-[var(--color-accent-blue)] text-white shadow-md"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              )}
            >
              <KeyRound className="h-3.5 w-3.5" />
              Manual Token
            </button>
          </div>

          {/* Broker Selection */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
              <Server className="h-3.5 w-3.5" />
              Broker
            </label>
            <select
              value={brokerName}
              onChange={(e) => setBrokerName(e.target.value as "fyers" | "zerodha")}
              className="focus-ring w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-2 text-sm text-[var(--color-text-primary)]"
            >
              <option value="fyers">Fyers</option>
              <option value="zerodha">Zerodha</option>
            </select>
          </div>

          {/* Sub-tabs for Manual Mode */}
          {loginType === "manual" && (
            <div className="flex gap-2 rounded-md bg-[var(--color-bg-primary)]/50 p-1 border border-[var(--color-border)]/50">
              <button
                type="button"
                onClick={() => setManualMode("paste")}
                className={cn(
                  "flex-1 rounded py-1.5 text-xs font-semibold uppercase transition-all",
                  manualMode === "paste"
                    ? "bg-[var(--color-accent-blue)] text-white shadow-sm"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                )}
              >
                Paste Token
              </button>
              <button
                type="button"
                onClick={() => setManualMode("wizard")}
                className={cn(
                  "flex-1 rounded py-1.5 text-xs font-semibold uppercase transition-all",
                  manualMode === "wizard"
                    ? "bg-[var(--color-accent-blue)] text-white shadow-sm"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                )}
              >
                OAuth Helper
              </button>
            </div>
          )}

          {/* AUTO LOGIN FORM FIELDS */}
          {loginType === "totp" && (
            <div className="space-y-4">
              {/* API Key */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                  {brokerName === "fyers" ? "Fyers App ID" : "Kite API Key"}
                </label>
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={brokerName === "fyers" ? "Enter Fyers App ID" : "Enter Zerodha API key"}
                  required
                  className="focus-ring w-full"
                />
              </div>

              {/* API Secret */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                  {brokerName === "fyers" ? "Fyers Secret Key" : "Kite API Secret"}
                </label>
                <div className="relative">
                  <input
                    type={showApiSecret ? "text" : "password"}
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    placeholder={brokerName === "fyers" ? "Enter Fyers Secret Key" : "Enter Zerodha API secret"}
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

              {/* User ID */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                  {brokerName === "fyers" ? "Fyers Client ID" : "Kite User ID"}
                </label>
                <input
                  type="text"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder={brokerName === "fyers" ? "Enter Fyers Client ID" : "Enter Kite client ID"}
                  required
                  className="focus-ring w-full"
                />
              </div>

              {/* Password (Zerodha Only) */}
              {brokerName !== "fyers" && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                    Kite Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter Kite password"
                      required
                      className="focus-ring w-full pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              )}

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

              {/* Security PIN (Fyers Only) */}
              {brokerName === "fyers" && (
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
              )}
            </div>
          )}

          {/* MANUAL DIRECT ACCESS TOKEN FIELD */}
          {loginType === "manual" && manualMode === "paste" && (
            <div className="space-y-4 animate-fade-in">
              {/* App ID / API Key depending on broker */}
              {brokerName === "fyers" ? (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                    App ID (Client ID)
                  </label>
                  <input
                    type="text"
                    value={appId}
                    onChange={(e) => setAppId(e.target.value)}
                    placeholder="Enter your Fyers App ID"
                    required
                    className="focus-ring w-full"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                    API Key
                  </label>
                  <input
                    type="text"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter your Zerodha API key"
                    required
                    className="focus-ring w-full"
                  />
                </div>
              )}

              {/* Access Token */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                  Access Token
                </label>
                <div className="relative">
                  <input
                    type={showToken ? "text" : "password"}
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="Enter your Access Token"
                    required
                    className="focus-ring w-full pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* MANUAL WIZARD CODE EXCHANGE FIELDS */}
          {loginType === "manual" && manualMode === "wizard" && (
            <div className="space-y-4 animate-fade-in">
              {/* API Key */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                  {brokerName === "fyers" ? "Fyers App ID" : "Kite API Key"}
                </label>
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={brokerName === "fyers" ? "Enter Fyers App ID" : "Enter Zerodha API key"}
                  required
                  className="focus-ring w-full"
                />
              </div>

              {/* API Secret */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                  {brokerName === "fyers" ? "Fyers Secret Key" : "Kite API Secret"}
                </label>
                <div className="relative">
                  <input
                    type={showApiSecret ? "text" : "password"}
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    placeholder={brokerName === "fyers" ? "Enter Fyers Secret Key" : "Enter Zerodha API secret"}
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

              {/* Redirect URI (Fyers Only) */}
              {brokerName === "fyers" && (
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
              )}

              {/* Step 1: Open authorize page */}
              <div className="rounded-lg bg-[var(--color-bg-primary)]/40 p-3 border border-[var(--color-border)]/30 space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-accent-blue)]">
                  Step 1: Get Authorization
                </span>
                <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                  Log in on the broker's secure site and grant permissions.
                </p>
                <a
                  href={getAuthUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "flex items-center justify-center gap-2 rounded px-3 py-2 text-xs font-semibold transition-all border",
                    !apiKey
                      ? "cursor-not-allowed border-[var(--color-border)] text-[var(--color-text-muted)] pointer-events-none"
                      : "border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/10 text-[var(--color-accent-blue)] hover:bg-[var(--color-accent-blue)] hover:text-white"
                  )}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Launch Broker Login Page
                </a>
              </div>

              {/* Step 2: Paste redirect code */}
              <div className="rounded-lg bg-[var(--color-bg-primary)]/40 p-3 border border-[var(--color-border)]/30 space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-accent-cyan)]">
                  Step 2: Authenticate Code
                </span>
                <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                  Paste the redirected URL or parameters containing the Code.
                </p>
                <input
                  type="text"
                  value={authCode}
                  onChange={(e) => {
                    const val = e.target.value.trim();
                    // If they paste the entire URL, extract code dynamically!
                    if (val.includes("auth_code=")) {
                      const codeMatch = val.match(/auth_code=([^&]+)/);
                      if (codeMatch) setAuthCode(codeMatch[1]);
                    } else if (val.includes("request_token=")) {
                      const tokenMatch = val.match(/request_token=([^&]+)/);
                      if (tokenMatch) setAuthCode(tokenMatch[1]);
                    } else {
                      setAuthCode(val);
                    }
                  }}
                  placeholder={brokerName === "fyers" ? "Paste Fyers auth_code or Redirect URL" : "Paste Zerodha request_token or Redirect URL"}
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
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-[var(--color-accent-red)]/10 p-3 text-sm text-[var(--color-accent-red)] animate-shake">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={
              isLoading ||
              (loginType === "totp"
                ? !userId || !totpSecret || !apiKey || !apiSecret || (brokerName === "fyers" && !pin)
                : manualMode === "wizard"
                ? !authCode || !apiKey || !apiSecret
                : !accessToken || (brokerName === "fyers" ? !appId : !apiKey))
            }
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white transition-all duration-200",
              isLoading ||
                (loginType === "totp"
                  ? !userId || !totpSecret || !apiKey || !apiSecret || (brokerName === "fyers" && !pin)
                  : manualMode === "wizard"
                  ? !authCode || !apiKey || !apiSecret
                  : !accessToken || (brokerName === "fyers" ? !appId : !apiKey))
                ? "cursor-not-allowed bg-[var(--color-bg-surface)] text-[var(--color-text-muted)]"
                : "bg-gradient-to-r from-[var(--color-accent-blue)] to-[var(--color-accent-cyan)] shadow-lg hover:shadow-[var(--shadow-glow-blue)] hover:brightness-110 active:scale-[0.98]"
            )}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Connecting to Broker...
              </>
            ) : (
              <>
                <Activity className="h-4 w-4" />
                {loginType === "manual" && manualMode === "wizard" ? (
                  <>
                    Authenticate & Connect
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </>
                ) : loginType === "totp" ? (
                  "Automate & Login"
                ) : (
                  "Connect & Start Trading"
                )}
              </>
            )}
          </button>
        </form>
      </div>

      {/* Footer */}
      <p className="mt-6 text-center text-xs text-[var(--color-text-muted)]">
        Secured directly by Broker API
      </p>
    </div>
  );
}
