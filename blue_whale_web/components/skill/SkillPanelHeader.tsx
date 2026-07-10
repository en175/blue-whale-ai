"use client";

import { BookMarked, SquarePen, Store, X } from "lucide-react";
import type { SkillTab } from "./data";

/**
 * SkillPanel 顶部条：tab 列表 + 关闭按钮。
 * 拆自原 components/SkillPanel.tsx（IJZYVO）。
 */

export default function SkillPanelHeader({
  activeTab,
  onChangeTab,
  onClose,
}: {
  activeTab: SkillTab;
  onChangeTab: (tab: SkillTab) => void;
  onClose: () => void;
}) {
  const tabBtn = (
    tab: SkillTab,
    Icon: React.ComponentType<{ size?: number; className?: string }>,
    label: string
  ) => {
    const selected = activeTab === tab;
    return (
      <button
        key={tab}
        type="button"
        className={`tc-agent-skill-panel__tab inline-flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium rounded-lg transition-colors duration-150 ${
          selected
            ? "tc-agent-skill-panel__tab--selected text-white/95"
            : "text-white/45 hover:text-white/70 hover:bg-white/[0.05]"
        }`}
        role="tab"
        aria-selected={selected}
        onClick={() => onChangeTab(tab)}
      >
        <span className="tc-agent-skill-panel__tab-icon">
          <Icon size={14} />
        </span>
        <span className="tc-agent-skill-panel__tab-label">{label}</span>
      </button>
    );
  };

  return (
    <div className="tc-agent-skill-panel__header flex items-center justify-between px-4 py-3 border-b border-white/[0.08]">
      <div
        className="tc-agent-skill-panel__tabs flex items-center gap-1"
        role="tablist"
        aria-label="Skill 视图"
      >
        {tabBtn("my", BookMarked, "我的 Skills")}
        {tabBtn("library", Store, "Skill 库")}
        {tabBtn("create", SquarePen, "创建 Skill")}
      </div>
      <button
        type="button"
        className="tc-agent-skill-panel__icon-btn inline-flex items-center justify-center w-8 h-8 rounded-lg text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors duration-150"
        aria-label="关闭 Skills"
        onClick={onClose}
      >
        <X size={16} />
      </button>
    </div>
  );
}
