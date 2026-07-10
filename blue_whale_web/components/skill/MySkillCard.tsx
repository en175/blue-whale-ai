"use client";

import type { MySkill } from "./data";
import MoreButton from "./MoreButton";
import UseButton from "./UseButton";

/**
 * "我的 Skills" 单卡：封面 + 标题/简介 + 自动开关 + Use/More 按钮。
 * 拆自原 components/SkillPanel.tsx（IJZYVO）。
 */
export default function MySkillCard({
  skill,
  auto,
  onToggleAuto,
  onUse,
}: {
  skill: MySkill;
  auto: boolean;
  onToggleAuto: () => void;
  onUse: () => void;
}) {
  return (
    <div
      className={`tc-agent-skill-row ${
        auto ? "tc-agent-skill-row--checked " : ""
      }tc-agent-skill-row--switch-control tc-agent-skill-row--with-cover grid grid-cols-[112px_minmax(0,1fr)] gap-3.5 min-h-[142px] p-3.5 rounded-xl bg-white/[0.035] border border-white/[0.08] transition-colors duration-150 hover:bg-white/[0.05]`}
    >
      <span
        className="tc-agent-skill-row__cover w-full h-full rounded-lg bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url("${skill.cover}")` }}
        aria-hidden="true"
      />
      <div className="tc-agent-skill-row__toggle flex flex-col min-w-0">
        <span className="tc-agent-skill-row__body flex flex-col gap-1">
          <span className="tc-agent-skill-row__title-line">
            <span className="tc-agent-skill-row__title text-[13px] font-semibold text-white/90 truncate">
              {skill.title}
            </span>
          </span>
          <span className="tc-agent-skill-row__desc text-xs text-white/50 line-clamp-2 leading-relaxed">
            {skill.description}
          </span>
        </span>
        <span className="tc-agent-skill-row__controls flex items-center gap-2 mt-auto">
          <span className="tc-agent-skill-row__quick-actions flex items-center gap-2">
            <UseButton onClick={onUse} />
            <button
              type="button"
              className="tc-agent-skill-row__switch"
              role="switch"
              aria-checked={auto}
              aria-label={`关闭自动应用： ${skill.title}`}
              aria-busy="false"
              data-tooltip="开启后，Agent 会在合适时机自动应用此 Skill。"
              onClick={onToggleAuto}
            >
              <span className="tc-agent-skill-row__switch-label">自动</span>
              <span
                className="tc-agent-skill-row__switch-thumb"
                aria-hidden="true"
              />
            </button>
          </span>
          <span className="tc-agent-skill-row__more-wrap ml-auto">
            <MoreButton label={`${skill.title} 的更多选项`} />
          </span>
        </span>
      </div>
    </div>
  );
}
