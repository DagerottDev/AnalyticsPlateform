"use client";

/**
 * Accounts Page — Connected broker account overview.
 *
 * Fyers is the only supported broker, and only one broker session is
 * active at a time, so this shows the single connected account (rather
 * than a multi-account list) with its live status and a disconnect action.
 */

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { LoginForm } from "@/components/auth/LoginForm";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/utils";
import {
  Activity,
  Fingerprint,
  LogOut,
  Shield,
  Tag,
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
      <span
        className={`text-sm font-semibold text-[var(--color-text-bright)] ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export default function AccountsPage() {
  const { user, tradingMode, logout, isPaperMode, brokerName } = useAuth();

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-3xl space-y-6 animate-fade-in pb-12">
        <div>
          <h2 className="text-xl font-black text-[var(--color-text-bright)] tracking-tight">
            Broker Accounts
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Manage your connected Fyers account
          </p>
        </div>

        {user ? (
          <div className="gradient-border rounded-xl shadow-xl">
            <div className="glass-strong rounded-xl p-6">
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
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {brokerName}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 rounded-full bg-[var(--color-accent-green)]/10 px-3 py-1 text-xs font-semibold text-[var(--color-accent-green)]">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-accent-green)] opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-accent-green)]" />
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
                  value={
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        isPaperMode
                          ? "bg-[var(--color-accent-blue)]/15 text-[var(--color-accent-blue)]"
                          : "bg-[var(--color-accent-red)]/15 text-[var(--color-accent-red)]"
                      }`}
                    >
                      {tradingMode}
                    </span>
                  }
                />
                <InfoRow
                  icon={Activity}
                  label="Connected Since"
                  value={formatDate(user.connected_at)}
                />
              </div>

              {/* Actions */}
              <div className="mt-6 flex justify-end border-t border-[var(--color-border-subtle)] pt-4">
                <button
                  onClick={logout}
                  className="flex items-center gap-2 rounded-lg border border-[var(--color-accent-red)]/30 bg-[var(--color-accent-red)]/10 px-4 py-2 text-xs font-semibold text-[var(--color-accent-red)] transition-colors hover:bg-[var(--color-accent-red)]/20"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Disconnect Account
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-8">
            <LoginForm />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
