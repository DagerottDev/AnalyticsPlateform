"use client";

import { useId, useState } from "react";
import { ExternalLink, Info, X } from "lucide-react";

export interface EducationLink {
  label: string;
  href: string;
}

interface EducationPopoverProps {
  title: string;
  description: string;
  tips?: string[];
  links?: EducationLink[];
}

/** Compact, keyboard-accessible help that keeps feature education close to the control it explains. */
export function EducationPopover({ title, description, tips = [], links = [] }: EducationPopoverProps) {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={`Learn about ${title}`}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-accent-blue)]/15 hover:text-[var(--color-accent-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]/50"
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <span id={contentId} role="dialog" aria-label={`${title} help`} className="absolute right-0 top-7 z-30 block w-80 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-3 text-left shadow-xl">
          <span className="mb-2 flex items-start justify-between gap-2">
            <strong className="text-sm text-[var(--color-text-bright)]">{title}</strong>
            <button type="button" onClick={() => setOpen(false)} aria-label={`Close ${title} help`} className="rounded p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-bright)]"><X className="h-3.5 w-3.5" /></button>
          </span>
          <span className="block text-xs leading-5 text-[var(--color-text-secondary)]">{description}</span>
          {tips.length > 0 && <span className="mt-2 block border-t border-[var(--color-border-subtle)] pt-2 text-xs leading-5 text-[var(--color-text-secondary)]">{tips.map((tip) => <span key={tip} className="block">• {tip}</span>)}</span>}
          {links.length > 0 && <span className="mt-2 block border-t border-[var(--color-border-subtle)] pt-2">{links.map((link) => <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-1 text-xs font-medium text-[var(--color-accent-blue)] hover:underline"><ExternalLink className="h-3 w-3" /> {link.label}</a>)}</span>}
        </span>
      )}
    </span>
  );
}
