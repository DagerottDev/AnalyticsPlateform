"use client";

/**
 * Header — Top navigation bar for the dashboard.
 *
 * Displays broker connection status, trading mode badge,
 * and user profile with logout action.
 */

import { useAuth } from "@/hooks/useAuth";
import { cn, formatDate } from "@/lib/utils";
import { useAlertStore } from "@/stores/alertStore";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Activity,
  Bell,
  BellOff,
  ChevronDown,
  LogOut,
  Shield,
  User,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function Header() {
  const router = useRouter();
  const { user, isAuthenticated, tradingMode, logout, isPaperMode, brokerName, sessionLive } =
    useAuth();
  const isConnected = isAuthenticated && sessionLive;
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const triggerLog = useAlertStore((state) => state.triggerLog);
  const clearTriggerLog = useAlertStore((state) => state.clearTriggerLog);

  return (
    <header className="glass-strong sticky top-0 z-50 flex h-14 items-center justify-between border-b border-[var(--color-border-default)] px-4">
      {/* Left — Brand */}
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--color-accent-blue)] to-[var(--color-accent-cyan)]">
          <Activity className="h-4 w-4 text-white" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-[var(--color-text-bright)]">
            Option Analytics
          </h1>
          <p className="text-[10px] text-[var(--color-text-muted)]">
            {brokerName}
          </p>
        </div>
      </div>

      {/* Center — Trading Mode */}
      <div className="flex items-center gap-3">
        {isAuthenticated && (
          <Badge tone={isPaperMode ? "blue" : "loss"} className="px-3 py-1 text-xs">
            {isPaperMode ? <Shield className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
            {isPaperMode ? "PAPER" : "LIVE"}
          </Badge>
        )}

        {/* Connection Status */}
        <div
          className={cn(
            "flex items-center gap-1.5 text-xs",
            isConnected
              ? "text-[var(--color-status-good)]"
              : isAuthenticated
                ? "text-[var(--color-status-serious)]"
                : "text-[var(--color-text-muted)]"
          )}
          title={
            isAuthenticated && !sessionLive
              ? "The backend broker session was lost (e.g. a server restart) — reconnect from the Accounts page."
              : undefined
          }
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              isConnected
                ? "bg-[var(--color-status-good)] animate-pulse-glow"
                : isAuthenticated
                  ? "bg-[var(--color-status-serious)]"
                  : "bg-[var(--color-text-muted)]"
            )}
          />
          {isConnected ? "Connected" : isAuthenticated ? "Session Lost" : "Not Connected"}
        </div>
      </div>

      {/* Right — Actions */}
      <div className="flex items-center gap-2">
        {/* Notifications */}
        <div className="relative">
          <Button
            variant="icon"
            aria-label="Notifications"
            onClick={() => {
              setShowNotifications((v) => !v);
              setShowUserMenu(false);
            }}
            className="relative"
          >
            <Bell className="h-4 w-4" />
            {triggerLog.length > 0 && (
              <span className="absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--color-accent-red)] px-0.5 text-[9px] font-bold text-white">
                {triggerLog.length > 9 ? "9+" : triggerLog.length}
              </span>
            )}
          </Button>

          {showNotifications && (
            <div className="glass-strong absolute right-0 top-full mt-1 w-72 rounded-lg border border-[var(--color-border-default)] p-1 shadow-lg animate-fade-in">
              <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-3 py-2">
                <p className="text-xs font-semibold text-[var(--color-text-bright)]">
                  Notifications
                </p>
                {triggerLog.length > 0 && (
                  <button
                    onClick={clearTriggerLog}
                    className="text-[10px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                  >
                    Clear all
                  </button>
                )}
              </div>

              <div className="max-h-72 overflow-y-auto">
                {triggerLog.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
                    <BellOff className="h-5 w-5 text-[var(--color-text-muted)]" />
                    <p className="text-xs text-[var(--color-text-muted)]">
                      No triggered alerts yet.
                    </p>
                  </div>
                ) : (
                  triggerLog.map((event) => (
                    <div
                      key={event.id}
                      className="border-b border-[var(--color-border-subtle)] px-3 py-2 last:border-0"
                    >
                      <p className="text-xs font-medium text-[var(--color-text-primary)]">
                        {event.tradingSymbol} {event.metric} {event.operator}{" "}
                        {event.threshold}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                        Triggered {formatDate(event.triggeredAt)}
                      </p>
                    </div>
                  ))
                )}
              </div>

              <button
                onClick={() => {
                  setShowNotifications(false);
                  router.push("/alerts");
                }}
                className="mt-1 flex w-full items-center justify-center rounded-md px-3 py-2 text-xs font-medium text-[var(--color-accent-blue)] transition-colors hover:bg-[var(--color-accent-blue)]/10"
              >
                View All Alerts
              </button>
            </div>
          )}
        </div>

        {/* User Menu */}
        <div className="relative">
          <button
            onClick={() => {
              setShowUserMenu((v) => !v);
              setShowNotifications(false);
            }}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            aria-label="User menu"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-bg-surface)]">
              <User className="h-3.5 w-3.5" />
            </div>
            <span className="hidden text-xs sm:inline">
              {user?.client_id || "User"}
            </span>
            <ChevronDown className="h-3 w-3" />
          </button>

          {/* Dropdown */}
          {showUserMenu && (
            <div className="glass-strong absolute right-0 top-full mt-1 w-48 rounded-lg border border-[var(--color-border-default)] p-1 shadow-lg animate-fade-in">
              <div className="border-b border-[var(--color-border-subtle)] px-3 py-2">
                <p className="text-xs font-medium text-[var(--color-text-bright)]">
                  {user?.client_id}
                </p>
                <p className="text-[10px] text-[var(--color-text-muted)]">
                  {user?.broker_name}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowUserMenu(false);
                  logout();
                }}
                className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-[var(--color-accent-red)] transition-colors hover:bg-[var(--color-accent-red)]/10"
              >
                <LogOut className="h-3.5 w-3.5" />
                Disconnect
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
