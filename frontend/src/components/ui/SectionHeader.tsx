import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  title: string;
  description?: string;
  className?: string;
}

/** Page-level heading — one title + optional subtitle, used at the top of
 * every page's PageContainer. */
export function SectionHeader({ title, description, className }: SectionHeaderProps) {
  return (
    <div className={className}>
      <h2 className="text-xl font-black tracking-tight text-[var(--color-text-bright)]">
        {title}
      </h2>
      {description && (
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{description}</p>
      )}
    </div>
  );
}

/** Small uppercase label used above groups of stats/tables/dividers — the
 * one scale for "eyebrow" text instead of every page inventing its own. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h3
      className={cn(
        "text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]",
        className
      )}
    >
      {children}
    </h3>
  );
}
