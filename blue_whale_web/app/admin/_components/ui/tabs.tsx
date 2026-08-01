"use client";

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex border-b border-[var(--tc-border)]">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${active === tab.key ? "border-[var(--tc-accent,#3b82f6)] text-[var(--tc-accent,#3b82f6)]" : "border-transparent text-[var(--tc-text-tertiary)] hover:text-[var(--tc-text-primary)]"}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
