"use client";

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--tc-border)]">
      <table className="w-full">{children}</table>
    </div>
  );
}

export function TableHeader({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-[var(--tc-border)] bg-[var(--tc-bg-surface)]">
      {children}
    </thead>
  );
}

export function TableHead({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-3 text-left text-xs font-medium text-[var(--tc-text-tertiary)] uppercase tracking-wider ${className}`}
    >
      {children}
    </th>
  );
}

export function TableBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TableRow({ children }: { children: React.ReactNode }) {
  return (
    <tr className="border-b border-[var(--tc-border-subtle)] last:border-0 hover:bg-[var(--tc-bg-surface)]/50 transition-colors">
      {children}
    </tr>
  );
}

export function TableCell({
  children,
  className = "",
  colSpan,
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`px-4 py-3 text-sm text-[var(--tc-text-primary)] ${className}`}
    >
      {children}
    </td>
  );
}
