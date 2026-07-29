"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  width = 480,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => onOpenChange(false)}>
      <div
        role="dialog" aria-modal="true" aria-label={title}
        className="border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto"
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--tc-border-subtle)] px-6 py-4">
          <h2 className="text-lg font-semibold text-[var(--tc-text-primary)]">{title}</h2>
          <button type="button" className="rounded-lg p-1.5 text-[var(--tc-text-muted)] hover:bg-[var(--tc-bg-elevated)] hover:text-[var(--tc-text-primary)] transition-colors" aria-label={`关闭${title}`} onClick={() => onOpenChange(false)}>
            <X size={18} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
