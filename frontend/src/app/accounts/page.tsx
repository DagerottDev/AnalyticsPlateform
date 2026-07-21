"use client";

/**
 * Accounts Page — Connected broker account overview.
 *
 * Fyers is the only supported broker, and only one broker session is
 * active at a time, so this shows the single connected account (rather
 * than a multi-account list) with its live status and a disconnect action.
 */

import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { LoginForm } from "@/components/auth/LoginForm";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/utils";
import { getSavedLoginCredentials, hasSavedTotpCredentials, clearSavedLoginCredentials, SAVED_LOGIN_KEYS } from "@/lib/auth";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import {
  Activity,
  Eye,
  EyeOff,
  Fingerprint,
  Loader2,
  LogOut,
  RefreshCw,
  Shield,
  Tag,
  Users,
  Zap,
} from "lucide-react";

function InfoRow({
  icon: Icon,
  label,
  value,
  mono = false,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] py-3 last:border-0">
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-muted)]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <span className={`text-sm font-semibold text-[var(--color-text-bright)] ${mono ? "tnum font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}

export default function AccountsPage() {
  const { user, tradingMode, logout, isPaperMode, brokerName, login, isLoading, error, clearError } = useAuth();
  const canRelogin = hasSavedTotpCredentials();

  const [showCredForm, setShowCredForm] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [formAppId, setFormAppId] = useState("");
  const [formApiSecret, setFormApiSecret] = useState("");
  const [formClientId, setFormClientId] = useState("");
  const [formTotpSecret, setFormTotpSecret] = useState("");
  const [formPin, setFormPin] = useState("");

  const relogin = async () => {
    clearError();
    const creds = getSavedLoginCredentials();
    if (!creds) return;
    try {
      await login({
        app_id: creds.appId,
        api_secret: creds.apiSecret,
        redirect_uri: creds.redirectUri,
        client_id: creds.clientId,
        totp_secret: creds.totpSecret,
        pin: creds.pin,
        trading_mode: creds.tradingMode,
      });
    } catch {
      // Error is surfaced via ApiErrorDisplay below.
    }
  };

  const handleReloginClick = () => {
    if (canRelogin) {
      relogin();
      return;
    }
    // No saved TOTP credentials yet — open the inline form, prefilled with
    // whatever was saved (e.g. app_id/api_secret from an earlier OAuth login).
    const creds = getSavedLoginCredentials();
    setFormAppId(creds?.appId || "");
    setFormApiSecret(creds?.apiSecret || "");
    setFormClientId(creds?.clientId || "");
    setFormTotpSecret(creds?.totpSecret || "");
    setFormPin(creds?.pin || "");
    setShowCredForm(true);
  };

  const handleSaveAndRelogin = async () => {
    localStorage.setItem(SAVED_LOGIN_KEYS.appId, formAppId);
    localStorage.setItem(SAVED_LOGIN_KEYS.apiSecret, formApiSecret);
    localStorage.setItem(SAVED_LOGIN_KEYS.clientId, formClientId);
    localStorage.setItem(SAVED_LOGIN_KEYS.totpSecret, formTotpSecret);
    localStorage.setItem(SAVED_LOGIN_KEYS.pin, formPin);
    localStorage.setItem(SAVED_LOGIN_KEYS.loginType, "totp");
    setShowCredForm(false);
    await relogin();
  };

  const isCredFormIncomplete = !formAppId || !formApiSecret || !formClientId || !formTotpSecret || !formPin;

  const handleChangeAccount = () => {
    clearSavedLoginCredentials();
    setShowCredForm(false);
    logout();
  };

  return (
    <DashboardLayout>
      <PageContainer className="max-w-3xl">
        <SectionHeader title="Broker Accounts" description="Manage your connected Fyers account" />

        {user ? (
          <Card variant="glass">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--color-accent-blue)] to-[var(--color-accent-cyan)]">
                  <Activity className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-[var(--color-text-bright)]">
                    {user.account_name || brokerName}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">{brokerName}</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 rounded-full bg-[var(--color-status-good)]/10 px-3 py-1 text-xs font-semibold text-[var(--color-status-good)]">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-status-good)] opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-status-good)]" />
                </span>
                Connected
              </div>
            </div>

            {/* Details */}
            <div className="mt-6">
              <InfoRow icon={Fingerprint} label="Client ID" value={user.client_id} mono />
              <InfoRow icon={Tag} label="Account Name" value={user.account_name || "—"} />
              <InfoRow
                icon={isPaperMode ? Shield : Zap}
                label="Trading Mode"
                value={<Badge tone={isPaperMode ? "blue" : "loss"}>{tradingMode}</Badge>}
              />
              <InfoRow icon={Activity} label="Connected Since" value={formatDate(user.connected_at)} />
            </div>

            {error ? <ApiErrorDisplay error={error} className="mt-4" /> : null}

            {/* Actions */}
            <div className="mt-6 flex flex-col gap-3 border-t border-[var(--color-border-subtle)] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={handleReloginClick}
                disabled={isLoading}
                title={canRelogin ? "Re-authenticate with Fyers using your saved TOTP credentials" : "Add your TOTP credentials to enable one-click relogin"}
              >
                {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Relogin (TOTP)
              </Button>

              <div className="flex gap-3">
                <Button variant="outline" size="sm" onClick={handleChangeAccount}>
                  <Users className="h-3.5 w-3.5" />
                  Change Account
                </Button>
                <Button variant="danger" size="sm" onClick={logout}>
                  <LogOut className="h-3.5 w-3.5" />
                  Disconnect Account
                </Button>
              </div>
            </div>

            {/* Inline TOTP credential entry — shown when none are saved yet */}
            {showCredForm && (
              <div className="mt-4 flex flex-col gap-3 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-hover)] p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  Add TOTP Credentials
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    value={formClientId}
                    onChange={(e) => setFormClientId(e.target.value)}
                    placeholder="Fyers Client ID"
                  />
                  <Input
                    value={formAppId}
                    onChange={(e) => setFormAppId(e.target.value)}
                    placeholder="Fyers App ID"
                  />
                  <div className="relative">
                    <Input
                      type={showSecrets ? "text" : "password"}
                      value={formApiSecret}
                      onChange={(e) => setFormApiSecret(e.target.value)}
                      placeholder="Fyers Secret Key"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecrets(!showSecrets)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                    >
                      {showSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Input
                    type={showSecrets ? "text" : "password"}
                    value={formTotpSecret}
                    onChange={(e) => setFormTotpSecret(e.target.value)}
                    placeholder="TOTP Secret (2FA Key)"
                  />
                  <Input
                    type={showSecrets ? "text" : "password"}
                    maxLength={4}
                    value={formPin}
                    onChange={(e) => setFormPin(e.target.value)}
                    placeholder="Security PIN"
                    className="font-mono tracking-widest"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowCredForm(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveAndRelogin} disabled={isCredFormIncomplete || isLoading}>
                    {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Save &amp; Relogin
                  </Button>
                </div>
              </div>
            )}
          </Card>
        ) : (
          <div className="flex justify-center py-8">
            <LoginForm />
          </div>
        )}
      </PageContainer>
    </DashboardLayout>
  );
}
