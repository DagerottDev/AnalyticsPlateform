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
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
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
      <span className={`text-sm font-semibold text-[var(--color-text-bright)] ${mono ? "tnum font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}

export default function AccountsPage() {
  const { user, tradingMode, logout, isPaperMode, brokerName } = useAuth();

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

            {/* Actions */}
            <div className="mt-6 flex justify-end border-t border-[var(--color-border-subtle)] pt-4">
              <Button variant="danger" size="sm" onClick={logout}>
                <LogOut className="h-3.5 w-3.5" />
                Disconnect Account
              </Button>
            </div>
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
