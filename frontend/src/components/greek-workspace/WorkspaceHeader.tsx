import Link from "next/link";
import { ArrowLeft, BarChart3, BellPlus, BookOpen, ExternalLink, Link2, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EducationPopover } from "@/components/ui/EducationPopover";
import { Select } from "@/components/ui/Select";
import { CORE_GREEKS_REFERENCE } from "@/lib/greekEducation";
import type { RollingSelectionMode } from "@/lib/analysisSelections";

interface WorkspaceHeaderProps {
  symbol: string;
  expiry: string;
  selectedCount: number;
  loading: boolean;
  educationOpen: boolean;
  layoutMessage: string;
  onShowEducation: () => void;
  onSave: () => void;
  onRefresh: () => void;
  onCreateAlert: () => void;
  onOpenMarketStructure: () => void;
  timeframe: string;
  onTimeframeChange: (timeframe: string) => void;
  syncCharts?: boolean;
  onToggleSyncCharts?: () => void;
  alertsDisabled?: boolean;
  alertDisabledReason?: string;
  rollingSelectionMode?: RollingSelectionMode;
  rollingToggleDisabled?: boolean;
  onToggleRollingMode?: () => void;
  replayActive?: boolean;
  replaySessionDate?: string;
}

export function WorkspaceHeader({
  symbol, expiry, selectedCount, loading, educationOpen, layoutMessage,
  onShowEducation, onSave, onRefresh, onCreateAlert, onOpenMarketStructure,
  timeframe, onTimeframeChange, syncCharts = false, onToggleSyncCharts = () => undefined, alertsDisabled = false, alertDisabledReason,
  rollingSelectionMode = "smooth", rollingToggleDisabled = false, onToggleRollingMode = () => undefined, replayActive = false, replaySessionDate,
}: WorkspaceHeaderProps) {
  return (
    <header className="flex flex-col gap-3 border-b border-[var(--color-border-default)] pb-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-start gap-3">
        <Link
          href="/chain"
          className="mt-1 rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-bright)]"
          title="Back to option chain"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-[var(--color-text-bright)]">
            <BarChart3 className="h-5 w-5 text-[var(--color-accent-blue)]" /> Option Greek workspace
            <EducationPopover
              title="Option Greek workspace"
              description="Select option contracts in the Option Chain, then compare their combined Greek exposure over history and with live quotes. The page intentionally uses the full window so charts have more room."
              tips={["Live aggregation waits until all selected contracts have quotes.", "Use the panel controls below to focus the dashboard on the sensitivities you need.", "Supertrend uses the selected timeframe's Greek series as its trend-following overlay."]}
              links={[{ label: "OIC: Understanding option Greeks", href: CORE_GREEKS_REFERENCE }]}
            />
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {symbol || "No instrument"}{expiry ? ` · ${expiry}` : ""} · {selectedCount} selected contracts
          </p>
          {replayActive && <p className="mt-1 inline-flex w-fit items-center rounded-full border border-[var(--color-accent-blue)]/40 bg-[var(--color-accent-blue)]/10 px-2 py-0.5 text-xs font-semibold text-[var(--color-accent-blue)]">Replay feed{replaySessionDate ? ` · ${replaySessionDate}` : ""}</p>}
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">History focus: recent session · {timeframe}-minute candles</p>
          {layoutMessage && <p className="mt-1 text-xs text-[var(--color-profit)]" role="status">{layoutMessage}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-2 rounded-md border border-[var(--color-border-default)] px-2 py-1 text-xs text-[var(--color-text-secondary)]">
          <span>Timeframe</span>
          <Select aria-label="Greek workspace timeframe" value={timeframe} onChange={(event) => onTimeframeChange(event.target.value)} className="h-8 w-24 text-xs">
            <option value="1">1 minute</option>
            <option value="3">3 minutes</option>
            <option value="5">5 minutes</option>
            <option value="10">10 minutes</option>
            <option value="15">15 minutes</option>
          </Select>
        </label>
        <Button variant={rollingSelectionMode === "smooth" ? "primary" : "outline"} size="sm" onClick={onToggleRollingMode} disabled={rollingToggleDisabled} aria-pressed={rollingSelectionMode === "smooth"} title={rollingToggleDisabled ? "Add a rolling ATM/OTM/ITM selection to change this mode." : "Smooth blends adjacent strikes by distance; Raw uses one exact rolled contract."}>
          {rollingSelectionMode === "smooth" ? "Smooth rolling" : "Raw rolling"}
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenMarketStructure} disabled={!symbol || !expiry} title="Open full-expiry OI and Greek concentration in a separate tab">
          <ExternalLink className="h-4 w-4" /> Market structure
        </Button>
        <Button variant="outline" size="sm" onClick={onCreateAlert} disabled={alertsDisabled} title={alertDisabledReason}><BellPlus className="h-4 w-4" /> Create alert</Button>
        <Button variant="outline" size="sm" onClick={onSave}><Save className="h-4 w-4" /> Save layout</Button>
        {!educationOpen && <Button variant="outline" size="sm" onClick={onShowEducation}><BookOpen className="h-4 w-4" /> Show education</Button>}
        <span className="flex items-center gap-1">
          <Button variant={syncCharts ? "primary" : "outline"} size="sm" onClick={onToggleSyncCharts} aria-pressed={syncCharts} title="Synchronize the time axis, horizontal zoom, and crosshair across every Greek chart">
            <Link2 className="h-4 w-4" /> {syncCharts ? "Charts synced" : "Sync charts"}
          </Button>
          <EducationPopover title="Sync chart timing, scale, and crosshair" description="When enabled, dragging or zooming any Greek chart applies the same time window to every chart. Hovering a chart also moves the vertical crosshair to the matching time on the other charts." tips={["Turn this on when comparing Greeks at the same moment.", "Turn it off when you want to inspect one chart independently.", "Each Greek keeps its own value axis because Greeks use different units and magnitudes."]} links={[{ label: "TradingView: compare charts", href: "https://www.tradingview.com/support/solutions/43000543033-how-to-synchronize-charts/" }]} />
        </span>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh {timeframe}m</Button>
      </div>
    </header>
  );
}
