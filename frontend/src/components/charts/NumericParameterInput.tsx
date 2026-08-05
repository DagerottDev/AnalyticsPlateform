"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";

interface NumericParameterInputProps {
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  className?: string;
  onValueChange: (value: number) => void;
}

function normalizeValue(value: number, min: number, max: number, integer: boolean): number {
  const bounded = Math.min(max, Math.max(min, value));
  return integer ? Math.round(bounded) : bounded;
}

function displayValue(value: number, integer: boolean): string {
  return integer ? String(Math.round(value)) : String(value);
}

/** Numeric chart parameter input that permits an empty draft while editing. */
export function NumericParameterInput({
  ariaLabel,
  value,
  min,
  max,
  step,
  integer = false,
  className,
  onValueChange,
}: NumericParameterInputProps) {
  const [draft, setDraft] = useState(() => displayValue(value, integer));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(displayValue(value, integer));
  }, [editing, integer, value]);

  const commit = (rawValue: string) => {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      setDraft(displayValue(value, integer));
      setEditing(false);
      return;
    }

    const normalized = normalizeValue(parsed, min, max, integer);
    onValueChange(normalized);
    setDraft(displayValue(normalized, integer));
    setEditing(false);
  };

  return (
    <Input
      aria-label={ariaLabel}
      type="number"
      inputMode={integer ? "numeric" : "decimal"}
      min={min}
      max={max}
      step={step}
      value={draft}
      onFocus={() => setEditing(true)}
      onChange={(event) => {
        const rawValue = event.target.value;
        setDraft(rawValue);
        setEditing(true);
        const parsed = event.target.valueAsNumber;
        if (Number.isFinite(parsed) && (!integer || Number.isInteger(parsed))) {
          onValueChange(normalizeValue(parsed, min, max, integer));
        }
      }}
      onBlur={() => commit(draft)}
      onKeyDown={(event) => {
        if (integer && [".", ",", "e", "E"].includes(event.key)) event.preventDefault();
      }}
      className={className}
    />
  );
}
