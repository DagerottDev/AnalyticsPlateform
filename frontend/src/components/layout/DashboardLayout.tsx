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
import { MobileNavigation } from "./MobileNavigation";
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
      <a
        href="#main-content"
        className="focus-ring sr-only fixed left-3 top-3 z-[100] rounded-md bg-[var(--color-accent-blue)] px-3 py-2 text-sm font-semibold text-white focus:not-sr-only"
      >
        Skip to main content
      </a>
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto p-3 pb-24 sm:p-4 sm:pb-24 md:pb-4">
          {children}
        </main>
      </div>
      <MobileNavigation />
      <ApiErrorLogPanel />
    </div>
  );
}
