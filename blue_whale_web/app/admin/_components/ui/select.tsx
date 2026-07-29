"use client";

type SelectProps = {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options?: { value: string; label: string }[];
  className?: string;
  children?: React.ReactNode;
};

export function Select({ value, onChange, options, className = "", children }: SelectProps) {
  return (
    <select value={value} onChange={onChange}
      className={`rounded-lg border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] px-3 py-2 text-sm text-[var(--tc-text-primary)] focus:border-[var(--tc-accent,#3b82f6)] focus:outline-none focus:ring-1 focus:ring-[var(--tc-ring)] transition-colors ${className}`}>
      {options ? options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>) : children}
    </select>
  );
}
