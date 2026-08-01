import { Activity, CalendarClock, Gauge, TrendingUp } from "lucide-react";
import { StatTile } from "@/components/ui/StatTile";
import { formatINR } from "@/lib/utils";

interface WorkspaceSummaryStripProps {
  spot: number;
  dte: number;
  atmIv: number | null;
  atmPrice: number | null;
  liveContracts: number;
  totalContracts: number;
}

/** At-a-glance context (spot, time-to-expiry, ATM IV/theoretical price, live
 * coverage) shown above the detailed Greek panels. Purely presentational —
 * all values are derived by the page from data it already fetches. */
export function WorkspaceSummaryStrip({ spot, dte, atmIv, atmPrice, liveContracts, totalContracts }: WorkspaceSummaryStripProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile label="Spot" value={formatINR(spot)} icon={TrendingUp} />
      <StatTile label="DTE" value={`${dte}d`} icon={CalendarClock} />
      <StatTile label="ATM IV" value={atmIv != null ? `${(atmIv * 100).toFixed(1)}%` : "—"} icon={Gauge} />
      <StatTile label="ATM Theoretical Price" value={atmPrice != null ? formatINR(atmPrice) : "—"} icon={Activity} />
      <StatTile
        label="Live Coverage"
        value={`${liveContracts}/${totalContracts}`}
        tone={liveContracts === totalContracts && totalContracts > 0 ? "profit" : "neutral"}
        className="col-span-2 sm:col-span-4"
      />
    </div>
  );
}
