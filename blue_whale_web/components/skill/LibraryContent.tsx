"use client";

import { ChevronDown, Search } from "lucide-react";
import type { LibrarySkill } from "./data";
import LibrarySkillCard from "./LibrarySkillCard";

/**
 * "Skill 库" tab 容器：搜索栏 + 排序入口 + skill 列表。
 * 拆自原 components/SkillPanel.tsx（IJZYVO）。
 */
export default function LibraryContent({
  skills,
  addedIds,
  search,
  setSearch,
  onUse,
  onToggleAdded,
}: {
  skills: LibrarySkill[];
  addedIds: Set<string>;
  search: string;
  setSearch: (v: string) => void;
  onUse: (title: string) => void;
  onToggleAdded: (id: string) => void;
}) {
  return (
    <div className="tc-agent-skill-panel__content tc-agent-skill-panel__content--store flex-1 min-h-0 overflow-hidden flex flex-col">
      <div className="tc-agent-skill-panel__library-tools flex items-center gap-3 p-4 border-b border-white/[0.08]">
        <div className="tc-agent-skill-panel__search-group flex flex-1 items-center gap-2">
          <label className="tc-agent-skill-panel__search flex flex-1 items-center gap-2 bg-white/[0.05] rounded-lg px-3 py-2 border border-white/[0.06]">
            <Search size={14} className="text-white/40" />
            <input
              type="text"
              className="bg-transparent outline-none text-[13px] text-white/90 placeholder:text-white/30 w-full"
              placeholder="搜索 Skills"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="tc-agent-skill-panel__search-submit h-8 px-3 text-[13px] font-medium text-white/80 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] transition-colors"
          >
            搜索
          </button>
        </div>
        <div className="tc-agent-skill-panel__sort">
          <button
            type="button"
            className="tc-agent-skill-panel__sort-trigger inline-flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium text-white/70 rounded-lg border border-white/[0.06] hover:bg-white/[0.05] transition-colors"
            aria-label="排序 Skills"
            aria-expanded="false"
            aria-haspopup="menu"
          >
            <span className="tc-agent-skill-panel__sort-label">排序</span>
            <span className="tc-agent-skill-panel__sort-value text-white/90">
              精选
            </span>
            <ChevronDown size={14} />
          </button>
        </div>
      </div>
      <div className="tc-agent-skill-panel__store-scroll flex-1 overflow-y-auto p-4">
        <div className="tc-agent-skill-panel__store-grid grid grid-cols-2 gap-3">
          {skills.map((skill) => (
            <LibrarySkillCard
              key={skill.id}
              skill={skill}
              added={addedIds.has(skill.id)}
              onUse={() => onUse(skill.title)}
              onToggleAdded={() => onToggleAdded(skill.id)}
            />
          ))}
        </div>
        <div
          className="tc-agent-skill-panel__load-more-sentinel h-4"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
