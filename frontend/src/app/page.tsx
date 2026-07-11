"use client";

/**
 * Home Page — Entry point that shows login or redirects to dashboard.
 *
 * Uses the DashboardLayout which handles auth gating internally.
 */

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function HomePage() {
  const { isAuthenticated, hydrated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (hydrated && isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [hydrated, isAuthenticated, router]);

  // DashboardLayout shows LoginForm when not authenticated
  return (
    <DashboardLayout>
      <div />
    </DashboardLayout>
  );
}
