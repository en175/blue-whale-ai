"use client";

import { Users } from "lucide-react";
import type { LibrarySkill } from "./data";
import MoreButton from "./MoreButton";
import UseButton from "./UseButton";

/**
 * "Skill 库" 单卡：封面 + 标题/简介/用量 + Use/添加/More 按钮。
 * 拆自原 components/SkillPanel.tsx（IJZYVO）。
 */
export default function LibrarySkillCard({
  skill,
  added,
  onUse,
  onToggleAdded,
}: {
  skill: LibrarySkill;
  added: boolean;
  onUse: () => void;
  onToggleAdded: () => void;
}) {
  return (
    <div
      className={`tc-agent-skill-row tc-agent-skill-row--no-control tc-agent-skill-row--with-cover ${
        added ? "tc-agent-skill-row--checked" : ""
      } grid grid-cols-[112px_minmax(0,1fr)] gap-3.5 min-h-[142px] p-3.5 rounded-xl bg-white/[0.035] border border-white/[0.08] hover:bg-white/[0.05] transition-colors`}
    >
      <span
        className="tc-agent-skill-row__cover w-full h-full rounded-lg bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url("${skill.cover}")` }}
        aria-hidden="true"
      />
      <div className="tc-agent-skill-row__toggle flex flex-col min-w-0">
        <span className="tc-agent-skill-row__body flex flex-col gap-1">
          <span className="tc-agent-skill-row__title-line">
            <span className="tc-agent-skill-row__title text-[13px] font-semibold text-white/90 line-clamp-1">
              {skill.title}
            </span>
          </span>
          <span className="tc-agent-skill-row__desc text-xs text-white/50 line-clamp-2 leading-relaxed">
            {skill.description}
          </span>
          <span className="tc-agent-skill-row__library-meta flex items-center gap-3 mt-1 text-[11px] text-white/40">
            <span className="tc-agent-skill-row__usage inline-flex items-center gap-1">
              <Users size={12} />
              <span>{skill.usage}</span>
            </span>
            <span className="tc-agent-skill-row__contributor">
              {skill.contributor}
            </span>
          </span>
        </span>
        <span className="tc-agent-skill-row__controls flex items-center gap-2 mt-auto">
          <UseButton onClick={onUse} />
          <button
            type="button"
            className={`tc-agent-skill-row__action h-7 px-2.5 rounded-md text-[11px] font-medium border border-white/[0.08] transition-colors ${
              added
                ? "text-white/30 cursor-not-allowed"
                : "text-white/70 hover:bg-white/[0.08] hover:text-white"
            }`}
            disabled={added}
            onClick={!added ? onToggleAdded : undefined}
          >
            {added ? "已添加" : "添加"}
          </button>
          <span className="tc-agent-skill-row__more-wrap ml-auto">
            <MoreButton label={`${skill.title} 的更多选项`} />
          </span>
        </span>
      </div>
    </div>
  );
}
