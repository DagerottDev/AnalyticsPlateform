"use client";

/**
 * Header — Top navigation bar for the dashboard.
 *
 * Displays broker connection status, trading mode badge,
 * and user profile with logout action.
 */

import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import {
  Activity,
  Bell,
  ChevronDown,
  LogOut,
  Settings,
  Shield,
  User,
  Zap,
} from "lucide-react";
import { useState } from "react";

export function Header() {
  const { user, isAuthenticated, tradingMode, logout, isPaperMode, brokerName } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);

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
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
              isPaperMode
                ? "bg-[var(--color-accent-blue)]/15 text-[var(--color-accent-blue)]"
                : "bg-[var(--color-accent-red)]/15 text-[var(--color-accent-red)]"
            )}
          >
            {isPaperMode ? (
              <Shield className="h-3 w-3" />
            ) : (
              <Zap className="h-3 w-3" />
            )}
            {isPaperMode ? "PAPER" : "LIVE"}
          </div>
        )}

        {/* Connection Status */}
        <div
          className={cn(
            "flex items-center gap-1.5 text-xs",
            isAuthenticated
              ? "text-[var(--color-accent-green)]"
              : "text-[var(--color-text-muted)]"
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              isAuthenticated
                ? "bg-[var(--color-accent-green)] animate-pulse-glow"
                : "bg-[var(--color-text-muted)]"
            )}
          />
          {isAuthenticated ? "Connected" : "Not Connected"}
        </div>
      </div>

      {/* Right — Actions */}
      <div className="flex items-center gap-2">
        {/* Notifications */}
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
        </button>

        {/* Settings */}
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>

        {/* User Menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
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
