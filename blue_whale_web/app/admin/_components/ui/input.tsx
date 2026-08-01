"use client";

export function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-lg border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] px-3 py-2 text-sm text-[var(--tc-text-primary)] placeholder:text-[var(--tc-text-muted)] focus:border-[var(--tc-accent,#3b82f6)] focus:outline-none focus:ring-1 focus:ring-[var(--tc-ring)] transition-colors ${className}`}
      {...props}
    />
  );
}
