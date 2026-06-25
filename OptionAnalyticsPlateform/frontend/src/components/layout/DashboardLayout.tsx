"use client";

/**
 * DashboardLayout — Main application layout wrapper.
 *
 * Combines Header + Sidebar + main content area.
 * Handles authentication gating and responsive layout.
 */

import { useAuth } from "@/hooks/useAuth";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { LoginForm } from "@/components/auth/LoginForm";
import { Loader2 } from "lucide-react";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { isAuthenticated, hydrated } = useAuth();

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

  // Show login form if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-[var(--color-bg-primary)] p-4">
        {/* Background gradient */}
        <div className="pointer-events-none fixed inset-0">
          <div className="absolute -left-40 top-0 h-[500px] w-[500px] rounded-full bg-[var(--color-accent-blue)]/5 blur-[120px]" />
          <div className="absolute -right-40 bottom-0 h-[500px] w-[500px] rounded-full bg-[var(--color-accent-cyan)]/5 blur-[120px]" />
          <div className="absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-accent-purple)]/3 blur-[100px]" />
        </div>
        <LoginForm />
      </div>
    );
  }

  // Authenticated layout
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--color-bg-primary)]">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-4">
          {children}
        </main>
      </div>
    </div>
  );
}
