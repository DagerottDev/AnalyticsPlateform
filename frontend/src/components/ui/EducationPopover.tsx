"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState } from "react";
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

interface PopoverPosition {
  left: number;
  top: number;
  width: number;
}

const POPOVER_MAX_WIDTH = 320;
const VIEWPORT_GUTTER = 8;
const TRIGGER_GAP = 8;

/** Compact, keyboard-accessible help that keeps feature education close to the control it explains. */
export function EducationPopover({ title, description, tips = [], links = [] }: EducationPopoverProps) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  /**
   * EducationPopover instances live inside the scrollable dashboard main area.
   * An absolutely positioned panel can therefore be clipped by that area's
   * left edge (most noticeable beside the collapsed sidebar). Position the
   * panel in a body portal and clamp it to the content viewport instead.
   */
  const positionPopover = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") return;

    const triggerRect = trigger.getBoundingClientRect();
    const main = trigger.closest("main");
    const mainRect = main?.getBoundingClientRect();
    const minLeft = Math.max(
      VIEWPORT_GUTTER,
      (mainRect?.left ?? 0) + VIEWPORT_GUTTER,
    );
    const maxRight = Math.max(minLeft + 1, window.innerWidth - VIEWPORT_GUTTER);
    const width = Math.min(POPOVER_MAX_WIDTH, Math.max(1, maxRight - minLeft));
    const maxLeft = Math.max(minLeft, maxRight - width);
    const preferredLeft = triggerRect.right - width;
    const left = Math.min(Math.max(preferredLeft, minLeft), maxLeft);
    const measuredHeight = contentRef.current?.getBoundingClientRect().height ?? 0;
    const preferredTop = triggerRect.bottom + TRIGGER_GAP;
    const maxTop = Math.max(
      VIEWPORT_GUTTER,
      window.innerHeight - measuredHeight - VIEWPORT_GUTTER,
    );
    const top = Math.min(preferredTop, maxTop);
    const nextPosition = { left, top, width };

    setPosition((current) => (
      current
      && current.left === nextPosition.left
      && current.top === nextPosition.top
      && current.width === nextPosition.width
        ? current
        : nextPosition
    ));
  }, []);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }

    positionPopover();
    // The first pass positions the panel before it is painted; the deferred
    // pass accounts for its measured height so it also stays inside short
    // windows. A timeout keeps this safe in jsdom, which may not expose RAF.
    const frame = window.setTimeout(positionPopover, 0);
    const handleViewportChange = () => positionPopover();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.clearTimeout(frame);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, positionPopover]);

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const closePopover = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const content = open && position && typeof document !== "undefined"
    ? createPortal(
      <div
        ref={contentRef}
        id={contentId}
        role="dialog"
        aria-label={`${title} help`}
        className="fixed z-[80] max-h-[calc(100vh-1rem)] overflow-y-auto rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-3 text-left shadow-xl"
        style={{ left: position.left, top: position.top, width: position.width }}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <strong className="text-sm text-[var(--color-text-bright)]">{title}</strong>
          <button
            type="button"
            onClick={closePopover}
            aria-label={`Close ${title} help`}
            className="rounded p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-bright)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="text-xs leading-5 text-[var(--color-text-secondary)]">{description}</p>
        {tips.length > 0 && (
          <div className="mt-2 border-t border-[var(--color-border-subtle)] pt-2 text-xs leading-5 text-[var(--color-text-secondary)]">
            {tips.map((tip) => <p key={tip}>• {tip}</p>)}
          </div>
        )}
        {links.length > 0 && (
          <div className="mt-2 border-t border-[var(--color-border-subtle)] pt-2">
            {links.map((link) => (
              <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-1 text-xs font-medium text-[var(--color-accent-blue)] hover:underline">
                <ExternalLink className="h-3 w-3" /> {link.label}
              </a>
            ))}
          </div>
        )}
      </div>,
      document.body,
    )
    : null;

  return (
    <span className="relative inline-flex align-middle">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Learn about ${title}`}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-accent-blue)]/15 hover:text-[var(--color-accent-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]/50"
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </button>
      {content}
    </span>
  );
}
