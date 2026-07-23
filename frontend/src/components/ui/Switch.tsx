import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

/** A labeled boolean toggle — used on the Settings page for on/off preferences. */
export function Switch({ checked, onChange, disabled, label, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "focus-ring inline-flex h-6 w-10 shrink-0 items-center rounded-full p-1 transition-colors duration-150",
        checked ? "bg-[var(--color-accent-blue)]" : "bg-[var(--color-bg-hover)]",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
    >
      <span
        className={cn(
          "h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150",
          checked && "translate-x-4"
        )}
      />
    </button>
  );
}
