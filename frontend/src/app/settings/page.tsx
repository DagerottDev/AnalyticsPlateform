"use client";

import { useState } from "react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Button } from "@/components/ui/Button";
import { INDICES } from "@/components/market/InstrumentSelector";
import { useSettingsStore, ThemeMode } from "@/stores/settingsStore";
import { requestNotificationPermission } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { Moon, Sun, Palette, Bell, SlidersHorizontal, RotateCcw } from "lucide-react";

function ThemeOption({
  mode,
  active,
  onSelect,
}: {
  mode: ThemeMode;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = mode === "dark" ? Moon : Sun;
  const label = mode === "dark" ? "Dark" : "Light";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-1 flex-col items-center gap-2 rounded-lg border p-4 transition-all",
        active
          ? "border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/10 text-[var(--color-accent-blue)]"
          : "border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-text-primary)]"
      )}
    >
      <Icon className="h-5 w-5" />
      <span className="text-sm font-semibold">{label}</span>
    </button>
  );
}

export default function SettingsPage() {
  const {
    theme,
    defaultSymbol,
    notifyToast,
    notifyDesktop,
    setTheme,
    setDefaultSymbol,
    setNotifyToast,
    setNotifyDesktop,
    resetToDefaults,
  } = useSettingsStore();

  const [requestingPermission, setRequestingPermission] = useState(false);

  const handleToggleDesktop = async (enabled: boolean) => {
    if (!enabled) {
      setNotifyDesktop(false);
      return;
    }

    setRequestingPermission(true);
    try {
      const permission = await requestNotificationPermission();
      if (permission === "granted") {
        setNotifyDesktop(true);
        toast.success("Desktop notifications enabled");
      } else {
        setNotifyDesktop(false);
        toast.error("Desktop notifications blocked", {
          description: "Allow notifications for this site in your browser settings, then try again.",
        });
      }
    } finally {
      setRequestingPermission(false);
    }
  };

  const handleReset = () => {
    resetToDefaults();
    toast.success("Settings reset to defaults");
  };

  return (
    <DashboardLayout>
      <PageContainer>
        <div className="flex items-center justify-between gap-4">
          <SectionHeader
            title="Settings"
            description="App-wide preferences — saved locally and applied immediately."
          />
          <Button variant="ghost" size="sm" onClick={handleReset}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset to Defaults
          </Button>
        </div>

        {/* Appearance */}
        <Card className="flex flex-col gap-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text-bright)]">
            <Palette className="h-4 w-4 text-[var(--color-accent-blue)]" /> Appearance
          </h3>
          <div className="flex gap-3">
            <ThemeOption mode="dark" active={theme === "dark"} onSelect={() => setTheme("dark")} />
            <ThemeOption mode="light" active={theme === "light"} onSelect={() => setTheme("light")} />
          </div>
        </Card>

        {/* General */}
        <Card className="flex flex-col gap-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text-bright)]">
            <SlidersHorizontal className="h-4 w-4 text-[var(--color-accent-blue)]" /> General
          </h3>
          <div className="max-w-xs">
            <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
              Default Symbol
            </label>
            <Select value={defaultSymbol} onChange={(e) => setDefaultSymbol(e.target.value)}>
              {INDICES.map((idx) => (
                <option key={idx} value={idx}>
                  {idx}
                </option>
              ))}
            </Select>
            <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
              Pre-selected on Option Chain, Charts, Volatility, Dealer Flow, Alerts, Strategy Builder, and Replay Mode.
            </p>
          </div>
        </Card>

        {/* Notifications */}
        <Card className="flex flex-col gap-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text-bright)]">
            <Bell className="h-4 w-4 text-[var(--color-accent-blue)]" /> Notifications
          </h3>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">Toast notifications</p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Show an in-app toast when an alert triggers.
              </p>
            </div>
            <Switch checked={notifyToast} onChange={setNotifyToast} label="Toggle toast notifications" />
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-[var(--color-border-subtle)] pt-4">
            <div>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">Desktop notifications</p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Also send a browser notification when an alert triggers, even if this tab isn&apos;t focused.
              </p>
            </div>
            <Switch
              checked={notifyDesktop}
              onChange={handleToggleDesktop}
              disabled={requestingPermission}
              label="Toggle desktop notifications"
            />
          </div>
        </Card>
      </PageContainer>
    </DashboardLayout>
  );
}
