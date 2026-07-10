"use client";

import { AtSign } from "lucide-react";

/**
 * "直接使用" 按钮 —— 在 MySkillCard / LibrarySkillCard 复用。
 * 拆自原 components/SkillPanel.tsx（IJZYVO）。
 */
export default function UseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="tc-agent-skill-row__action tc-agent-skill-row__action--use inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium text-white/80 border border-white/[0.08] hover:bg-white/[0.08] hover:text-white transition-colors"
      onClick={onClick}
    >
      <AtSign size={12} aria-hidden="true" />
      <span>直接使用</span>
    </button>
  );
}
