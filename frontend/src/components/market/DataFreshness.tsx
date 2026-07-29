import type { MarketTick } from "@/types/market";
import { Badge } from "@/components/ui/Badge";
import { describeDataFreshness } from "@/lib/dataFreshness";

export function DataFreshness({ tick }: { tick: MarketTick | null | undefined }) {
  const freshness = describeDataFreshness(tick);
  const tone = freshness.state === "live" ? "profit" : freshness.state === "delayed" ? "orange" : "neutral";

  return <Badge tone={tone} title={freshness.detail}>{freshness.label}</Badge>;
}
