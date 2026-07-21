import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export function Switch({ checked, onCheckedChange, disabled, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "focus-ring relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150",
        checked ? "bg-[var(--color-accent-blue)]" : "bg-[var(--color-bg-hover)]",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-150",
          checked ? "translate-x-[19px]" : "translate-x-1"
        )}
      />
    </button>
  );
}
