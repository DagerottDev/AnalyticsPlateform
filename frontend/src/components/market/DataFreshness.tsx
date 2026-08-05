import type { MarketTick } from "@/types/market";
import { Badge } from "@/components/ui/Badge";
import { describeDataFreshness } from "@/lib/dataFreshness";
import type { MarketSegment } from "@/lib/marketSession";

export function DataFreshness({
  tick,
  segment = "fno",
}: {
  tick: MarketTick | null | undefined;
  segment?: MarketSegment;
}) {
  const freshness = describeDataFreshness(tick, Date.now(), segment);
  const tone = freshness.state === "live" ? "profit" : freshness.state === "delayed" ? "orange" : "neutral";

  return <Badge tone={tone} title={freshness.detail}>{freshness.label}</Badge>;
}
