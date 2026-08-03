"use client";

type BadgeVariant =
  "default" | "secondary" | "outline" | "success" | "destructive";

const VARIANTS: Record<BadgeVariant, string> = {
  default: "bg-[var(--tc-accent,#3b82f6)]/15 text-[var(--tc-accent,#3b82f6)]",
  secondary: "bg-[var(--tc-bg-elevated)] text-[var(--tc-text-secondary)]",
  outline: "border border-[var(--tc-border)] text-[var(--tc-text-tertiary)]",
  success: "bg-[#22c55e]/15 text-[#22c55e]",
  destructive: "bg-[#ef4444]/15 text-[#ef4444]",
};

export function Badge({
  variant = "default",
  className = "",
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
