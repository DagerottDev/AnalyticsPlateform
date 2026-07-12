import { AlertCircle, Copy, Check } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface ApiErrorDisplayProps {
  error: unknown;
  className?: string;
}

/**
 * Extracts a detailed, readable string from any error object,
 * ensuring no information is swallowed (e.g. backend tracebacks or validation errors).
 */
export function formatApiError(error: unknown): string {
  if (!error) return "";
  
  if (typeof error === "string") return error;

  // Handle Axios errors or similar structures
  const anyErr = error as any;
  let errorString = "";

  if (anyErr.response) {
    // The request was made and the server responded with a status code
    // that falls out of the range of 2xx
    errorString += `Status: ${anyErr.response.status}\n`;
    if (anyErr.response.data) {
      if (typeof anyErr.response.data === "object") {
        errorString += `Data: ${JSON.stringify(anyErr.response.data, null, 2)}`;
      } else {
        errorString += `Data: ${anyErr.response.data}`;
      }
    }
  } else if (anyErr.request) {
    // The request was made but no response was received
    errorString += `Network Error: No response received. ${anyErr.message || ""}`;
  } else {
    // Something happened in setting up the request that triggered an Error
    errorString += anyErr.message || "Unknown error occurred";
  }

  return errorString;
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
