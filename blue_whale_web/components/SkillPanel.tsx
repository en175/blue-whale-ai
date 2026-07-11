"use client";

import { useEffect, useRef, useState } from "react";
import CreateSkillContent from "./skill/CreateSkillContent";
import { LIBRARY_SKILLS, MY_SKILLS, SKILL_MD_TEMPLATE, type SkillTab } from "./skill/data";
import LibraryContent from "./skill/LibraryContent";
import MySkillCard from "./skill/MySkillCard";
import SkillPanelHeader from "./skill/SkillPanelHeader";

/**
 * SkillPanel —— AgentChatPanel 触发的"技能面板"模态框。
 *
 * IJZYVO 拆自原 783 行单文件：编排 + 状态保留在主入口，渲染与样式
 * 拆到 components/skill/ 下子组件。
 *
 * 对外 props 契约（isOpen / onClose / onUseSkill）保持不变，
 * AgentChatPanel 调用点零改动。
 */
export interface SkillPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onUseSkill: (title: string) => void;
}

export default function SkillPanel({
  isOpen,
  onClose,
  onUseSkill,
}: SkillPanelProps) {
  const [activeTab, setActiveTab] = useState<SkillTab>("my");
  const [autoIds, setAutoIds] = useState<Set<string>>(
    () => new Set(MY_SKILLS.map((s) => s.id))
  );
  const [addedIds, setAddedIds] = useState<Set<string>>(
    () => new Set(LIBRARY_SKILLS.filter((s) => s.added).map((s) => s.id))
  );
  const [search, setSearch] = useState("");
  const [createMode, setCreateMode] = useState<"write" | "upload">("write");
  const [skillMd, setSkillMd] = useState(SKILL_MD_TEMPLATE);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const toggleAuto = (id: string) => {
    setAutoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAdded = (id: string) => {
    setAddedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      className="tc-agent-skill-modal-backdrop fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 motion-reduce:animate-none"
      onClick={onClose}
    >
      <div
        id="home-canvas-skill-panel"
        className="tc-agent-skill-panel bg-[#141414] border border-white/[0.12] rounded-2xl shadow-[var(--tc-modal-shadow)] w-[calc(100vw-56px)] max-w-[1440px] h-[calc(100vh-56px)] max-h-[920px] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none"
        role="dialog"
        aria-modal="true"
        aria-label="Skills"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <SkillPanelHeader
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          onClose={onClose}
        />

        {activeTab === "my" && (
          <div className="tc-agent-skill-panel__content flex flex-col flex-1 min-h-0 overflow-y-auto bg-[#141414] pt-4 px-[18px] pb-5">
            <div className="tc-agent-skill-panel__section">
              <div className="tc-agent-skill-panel__section-list grid grid-cols-2 gap-3">
                {MY_SKILLS.map((skill) => (
                  <MySkillCard
                    key={skill.id}
                    skill={skill}
                    auto={autoIds.has(skill.id)}
                    onToggleAuto={() => toggleAuto(skill.id)}
                    onUse={() => onUseSkill(skill.title)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "library" && (
          <LibraryContent
            skills={LIBRARY_SKILLS}
            addedIds={addedIds}
            search={search}
            setSearch={setSearch}
            onUse={onUseSkill}
            onToggleAdded={toggleAdded}
          />
        )}

        {activeTab === "create" && (
          <CreateSkillContent
            mode={createMode}
            setMode={setCreateMode}
            skillMd={skillMd}
            setSkillMd={setSkillMd}
          />
        )}
      </div>
    </div>
  );
}
