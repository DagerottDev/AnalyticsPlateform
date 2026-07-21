"use client";

/**
 * DashboardLayout — Main application layout wrapper.
 *
 * Combines Header + Sidebar + main content area. The shell renders
 * regardless of broker auth state — pages needing a live connection show
 * their own empty/connect states; the Accounts page is where you connect.
 */

import { useAuth } from "@/hooks/useAuth";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { ApiErrorLogPanel } from "./ApiErrorLogPanel";
import { Loader2 } from "lucide-react";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { hydrated } = useAuth();

  // Show loading state while hydrating from localStorage
  if (!hydrated) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-bg-primary)]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--color-accent-blue)]" />
          <p className="text-sm text-[var(--color-text-muted)]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--color-bg-primary)]">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-4">
          {children}
        </main>
      </div>
      <ApiErrorLogPanel />
    </div>
  );
}
