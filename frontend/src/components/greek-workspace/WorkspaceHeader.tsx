import Link from "next/link";
import { ArrowLeft, BarChart3, BellPlus, BookOpen, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EducationPopover } from "@/components/ui/EducationPopover";
import { CORE_GREEKS_REFERENCE } from "@/lib/greekEducation";

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
}

export function WorkspaceHeader({
  symbol, expiry, selectedCount, loading, educationOpen, layoutMessage,
  onShowEducation, onSave, onRefresh, onCreateAlert,
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
              tips={["Live aggregation waits until all selected contracts have quotes.", "Use the panel controls below to focus the dashboard on the sensitivities you need."]}
              links={[{ label: "OIC: Understanding option Greeks", href: CORE_GREEKS_REFERENCE }]}
            />
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {symbol || "No instrument"}{expiry ? ` · ${expiry}` : ""} · {selectedCount} selected contracts
          </p>
          {layoutMessage && <p className="mt-1 text-xs text-[var(--color-profit)]" role="status">{layoutMessage}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onCreateAlert}><BellPlus className="h-4 w-4" /> Create alert</Button>
        <Button variant="outline" size="sm" onClick={onSave}><Save className="h-4 w-4" /> Save layout</Button>
        {!educationOpen && <Button variant="outline" size="sm" onClick={onShowEducation}><BookOpen className="h-4 w-4" /> Show education</Button>}
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh historical values</Button>
      </div>
    </header>
  );
}
