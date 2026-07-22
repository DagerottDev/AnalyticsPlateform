import { AlertCircle, Copy, Check } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatApiError } from "@/lib/apiError";

interface ApiErrorDisplayProps {
  error: unknown;
  className?: string;
}

export function ApiErrorDisplay({ error, className }: ApiErrorDisplayProps) {
  const [copied, setCopied] = useState(false);

  if (!error) return null;

  const errorMessage = formatApiError(error);

  const handleCopy = () => {
    navigator.clipboard.writeText(errorMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("relative flex flex-col gap-2 rounded-lg bg-[var(--color-accent-red)]/10 p-4 text-sm text-[var(--color-accent-red)] animate-shake", className)}>
      <div className="flex items-start gap-2 pr-16">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1 overflow-x-auto">
          <pre className="whitespace-pre-wrap font-mono text-xs">{errorMessage}</pre>
        </div>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-2 right-2 flex items-center gap-1 rounded bg-[var(--color-accent-red)]/20 px-2 py-1 text-xs hover:bg-[var(--color-accent-red)]/30 transition-colors"
        title="Copy error details"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
