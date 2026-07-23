"use client";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { PageContainer } from "@/components/ui/PageContainer";
import { useRoadmapStore } from "@/stores/roadmapStore";
import { ROADMAP_ITEMS, ROADMAP_TIERS, type RoadmapArea } from "@/lib/roadmap";
import { CheckCircle2, Circle, Milestone, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

const AREA_BADGE_TONE: Record<RoadmapArea, "blue" | "profit" | "orange" | "purple" | "neutral"> = {
  "Data & Analytics": "blue",
  "Trading & Portfolio": "profit",
  "Alerts & Notifications": "orange",
  "Platform & Infra": "purple",
  Testing: "neutral",
  "UX & Design": "neutral",
};

export default function RoadmapPage() {
  const completed = useRoadmapStore((s) => s.completed);
  const toggleComplete = useRoadmapStore((s) => s.toggleComplete);
  const resetProgress = useRoadmapStore((s) => s.resetProgress);

  const total = ROADMAP_ITEMS.length;
  const done = ROADMAP_ITEMS.filter((item) => completed[item.id]).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <DashboardLayout>
      <PageContainer>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <SectionHeader
            title="Product Roadmap"
            description="What's built, what's missing, and what to add next — grounded in the current codebase, ordered basic to advanced."
          />
          {done > 0 && (
            <Button variant="ghost" size="sm" onClick={resetProgress} className="shrink-0">
              <RotateCcw className="h-3.5 w-3.5" />
              Reset progress
            </Button>
          )}
        </div>

        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-bold text-[var(--color-text-bright)]">
              <Milestone className="h-4 w-4 text-[var(--color-accent-blue)]" />
              Overall progress
            </span>
            <span className="tnum text-[var(--color-text-secondary)]">
              {done} / {total} shipped ({pct}%)
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-hover)]">
            <div
              className="h-full rounded-full bg-[var(--color-accent-blue)] transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </Card>

        {ROADMAP_TIERS.map((tier) => {
          const items = ROADMAP_ITEMS.filter((item) => item.tier === tier.id);
          const tierDone = items.filter((item) => completed[item.id]).length;

          return (
            <div key={tier.id} className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <div>
                  <h3 className="text-base font-black text-[var(--color-text-bright)]">{tier.label}</h3>
                  <p className="text-sm text-[var(--color-text-secondary)]">{tier.blurb}</p>
                </div>
                <span className="tnum shrink-0 text-xs text-[var(--color-text-muted)]">
                  {tierDone}/{items.length}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {items.map((item) => {
                  const isDone = !!completed[item.id];
                  return (
                    <Card
                      key={item.id}
                      className={cn(
                        "flex items-start gap-3 transition-opacity",
                        isDone && "opacity-60"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleComplete(item.id)}
                        aria-label={isDone ? "Mark as not done" : "Mark as done"}
                        className="mt-0.5 shrink-0 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-accent-blue)]"
                      >
                        {isDone ? (
                          <CheckCircle2 className="h-5 w-5 text-[var(--color-status-good)]" />
                        ) : (
                          <Circle className="h-5 w-5" />
                        )}
                      </button>

                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4
                            className={cn(
                              "text-sm font-bold text-[var(--color-text-bright)]",
                              isDone && "line-through"
                            )}
                          >
                            {item.title}
                          </h4>
                          <Badge tone={AREA_BADGE_TONE[item.area]}>{item.area}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{item.description}</p>
                        <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
                          <span className="font-bold uppercase tracking-wide text-[var(--color-text-muted)]/80">
                            Why —
                          </span>{" "}
                          {item.why}
                        </p>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </PageContainer>
    </DashboardLayout>
  );
}
