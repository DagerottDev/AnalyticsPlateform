"use client";

import { BookOpen, ExternalLink, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EducationAsideSection {
  title: string;
  body: string;
}

export interface EducationAsideLink {
  label: string;
  href: string;
}

interface EducationAsideProps {
  /** aria-label on the <aside> landmark, e.g. "Dealer Flow education". */
  ariaLabel: string;
  /** aria-label on the close button, e.g. "Hide Dealer Flow education". */
  closeLabel: string;
  title: string;
  intro: string;
  sections: EducationAsideSection[];
  links?: EducationAsideLink[];
  onClose: () => void;
}

/**
 * Shared shell for the per-workspace "How to use this page" learning rails
 * (Dealer Flow, Greek workspace, IV Screener, Relative Value). Each
 * workspace supplies only its own copy — the layout, icon, close button,
 * and "Learn more" link styling used to be duplicated four times.
 */
export function EducationAside({ ariaLabel, closeLabel, title, intro, sections, links = [], onClose }: EducationAsideProps) {
  return (
    <aside className="panel h-fit p-4 xl:sticky xl:top-4" aria-label={ariaLabel}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-[var(--color-accent-blue)]" />
          <h2 className="font-semibold text-[var(--color-text-bright)]">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-bright)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mb-3 text-xs leading-5 text-[var(--color-text-secondary)]">{intro}</p>
      <div className="space-y-3">
        {sections.map((section) => (
          <section key={section.title}>
            <h3 className="text-xs font-semibold text-[var(--color-text-bright)]">{section.title}</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">{section.body}</p>
          </section>
        ))}
      </div>
      {links.length > 0 && (
        <div className="mt-4 border-t border-[var(--color-border-subtle)] pt-3">
          <p className="mb-2 text-xs font-semibold text-[var(--color-text-bright)]">Learn more</p>
          {links.map((link, index) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "flex items-center gap-1 text-xs font-medium text-[var(--color-accent-blue)] hover:underline",
                index < links.length - 1 && "mb-2"
              )}
            >
              <ExternalLink className="h-3 w-3" /> {link.label}
            </a>
          ))}
        </div>
      )}
    </aside>
  );
}
