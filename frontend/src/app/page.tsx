"use client";

/**
 * Home Page — Entry point that redirects into the app.
 *
 * Always lands on /accounts once hydration settles, whether or not a
 * broker session is connected — the Accounts page is where you connect.
 */

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function HomePage() {
  const { hydrated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (hydrated) {
      router.replace("/accounts");
    }
  }, [hydrated, router]);

  return (
    <DashboardLayout>
      <div />
    </DashboardLayout>
  );
}
