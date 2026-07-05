"use client";

/**
 * LoginForm — Premium OpenAlgo authentication form.
 *
 * Features:
 * - Broker selection (Fyers / Zerodha)
 * - Dynamic credential fields
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
  const { login, isLoading, error, clearError } = useAuth();
  const [brokerName, setBrokerName] = useState<"fyers" | "zerodha">("fyers");
  const [appId, setAppId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [tradingMode, setTradingMode] = useState<TradingMode>("paper");
  const [showToken, setShowToken] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await login(brokerName, appId, apiKey, accessToken, tradingMode);
    } catch {
      // Error is handled by the store
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
          {/* Broker Selection */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
              <Server className="h-3.5 w-3.5" />
              Broker
            </label>
            <select
              value={brokerName}
              onChange={(e) => setBrokerName(e.target.value as any)}
              className="focus-ring w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-2 text-sm text-[var(--color-text-primary)]"
            >
              <option value="fyers">Fyers</option>
              <option value="zerodha">Zerodha</option>
            </select>
          </div>

          {/* Broker Specific Fields */}
          {brokerName === "fyers" && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                <KeyRound className="h-3.5 w-3.5" />
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
          )}

          {brokerName === "zerodha" && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                <KeyRound className="h-3.5 w-3.5" />
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

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
              <KeyRound className="h-3.5 w-3.5" />
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
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
                aria-label={showToken ? "Hide token" : "Show token"}
              >
                {showToken ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

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
            <div className="flex items-start gap-2 rounded-lg bg-[var(--color-accent-red)]/10 p-3 text-sm text-[var(--color-accent-red)]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading || !accessToken || (brokerName === 'fyers' ? !appId : !apiKey)}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white transition-all",
              isLoading || !accessToken || (brokerName === 'fyers' ? !appId : !apiKey)
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
                Connect & Start Trading
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
