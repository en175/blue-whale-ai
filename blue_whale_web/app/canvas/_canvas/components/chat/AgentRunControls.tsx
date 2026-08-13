export function AgentRunControls({
  status,
  error,
  onCancel,
  onResume,
  onSkip,
}: {
  status?: string | null;
  error?: string | null;
  onCancel?: () => Promise<void>;
  onResume?: () => Promise<void>;
  onSkip?: () => Promise<void>;
}) {
  return (
    <>
      {error && (
        <div
          className="rounded-lg border border-[var(--tc-destructive)]/30 bg-[var(--tc-destructive)]/10 px-3 py-2 text-xs text-white/80"
          role="alert"
        >
          {error}
        </div>
      )}
      {(onCancel || onResume || onSkip) && (
        <div className="flex flex-wrap justify-end gap-2 py-1">
          {status === "payment_required" && onResume && (
            <button
              type="button"
              onClick={() => void onResume()}
              className="rounded-lg bg-white px-3 py-1.5 text-xs text-black transition-colors hover:bg-white/90"
            >
              充值后继续
            </button>
          )}
          {(status === "failed" || status === "outcome_unknown") && onSkip && (
            <button
              type="button"
              onClick={() => void onSkip()}
              className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs text-white/65 transition-colors hover:bg-white/[0.08]"
            >
              跳过本轮
            </button>
          )}
          {(status === "queued" ||
            status === "running" ||
            status === "payment_required") &&
            onCancel && (
              <button
                type="button"
                onClick={() => void onCancel()}
                className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs text-white/65 transition-colors hover:bg-white/[0.08]"
              >
                取消运行
              </button>
            )}
        </div>
      )}
    </>
  );
}
