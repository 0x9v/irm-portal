import { ReactNode } from "react";
import Button from "@/components/ui/Button";

export type FeedbackType = "error" | "success" | "info" | "warning";

interface FeedbackMessageProps {
  type: FeedbackType;
  message?: string;
  children?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export default function FeedbackMessage({
  type,
  message,
  children,
  onRetry,
  retryLabel = "Retry",
  className = "",
}: FeedbackMessageProps) {
  const styles = {
    error: "bg-error-surface text-error border-error-border",
    success: "bg-success-surface text-success border-success-border",
    info: "bg-info-surface text-info border-info-border",
    warning: "bg-warning-surface text-warning border-warning-border",
  };

  const isAlert = type === "error";

  return (
    <div
      role={isAlert ? "alert" : "status"}
      aria-live={isAlert ? "assertive" : "polite"}
      className={`p-4 rounded-surface border text-sm leading-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${styles[type]} ${className}`}
    >
      <div className="[overflow-wrap:anywhere] min-w-0 flex-1 space-y-1">
        {message && <p className="font-medium">{message}</p>}
        {children}
      </div>
      {onRetry && (
        <Button
          type="button"
          variant="secondary"
          onClick={onRetry}
          className="self-start sm:self-center sm:shrink-0 max-w-full"
        >
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
