"use client";

/**
 * DashboardLayout — Main application layout wrapper.
 *
 * Combines Header + Sidebar + main content area. The shell renders
 * regardless of broker auth state — pages needing a live connection show
 * their own empty/connect states; the Accounts page is where you connect.
 */

import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { MobileNavigation } from "./MobileNavigation";
import { ApiErrorLogPanel } from "./ApiErrorLogPanel";

interface DashboardLayoutProps {
  children: React.ReactNode;
  sidebarCollapsed?: boolean;
}

export function DashboardLayout({ children, sidebarCollapsed = false }: DashboardLayoutProps) {
  // Keep the shell deterministic during SSR and the first client render.
  // Auth persistence hydrates in effects; gating this layout on that
  // client-only state produces a shell-vs-spinner hydration mismatch on
  // direct workspace URLs and when navigating between dashboard pages.
  return (
    <div className="flex h-dvh min-h-dvh flex-col overflow-hidden bg-[var(--color-bg-primary)]">
      <a
        href="#main-content"
        className="focus-ring sr-only fixed left-3 top-3 z-[100] rounded-md bg-[var(--color-accent-blue)] px-3 py-2 text-sm font-semibold text-white focus:not-sr-only"
      >
        Skip to main content
      </a>
      <Header />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar initialCollapsed={sidebarCollapsed} />
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto px-3 pb-24 pt-4 sm:px-5 sm:pb-24 sm:pt-5 md:pb-6 lg:px-7 lg:pt-6">
          {children}
        </main>
      </div>
      <MobileNavigation />
      <ApiErrorLogPanel />
    </div>
  );
}
