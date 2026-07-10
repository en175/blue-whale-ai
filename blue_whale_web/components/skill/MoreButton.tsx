"use client";

import { Ellipsis } from "lucide-react";

/**
 * "更多" 按钮（...）—— 在 MySkillCard / LibrarySkillCard 复用。
 * 拆自原 components/SkillPanel.tsx（IJZYVO）。
 */
export default function MoreButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="tc-agent-skill-row__more inline-flex items-center justify-center w-7 h-7 rounded-md text-white/50 hover:bg-white/[0.08] hover:text-white transition-colors"
      aria-label={label}
      aria-expanded="false"
    >
      <Ellipsis size={15} />
    </button>
  );
}
