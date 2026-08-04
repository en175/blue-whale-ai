"use client";

import { AtSign } from "lucide-react";
import { generateSkillCover } from "@/lib/skill-cover";

export const PAGE_SIZE = 50;

/** Use 选择：稳定 Creative Skill 身份（可空，库外项无）+ 展示名。 */
export type UseSkillSelection = {
  creative_skill_id: string | null;
  name: string;
};

export function StateHint({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-[13px] text-white/40">
      {text}
    </div>
  );
}

export function SkillCover({
  url,
  name,
}: {
  url?: string | null;
  name?: string | null;
}) {
  // cover_url 有值 → 背景图；空 → 名称驱动的确定性渐变 + 首字母（IK60WU/IK693G），
  // 不依赖第三方外链占位图。name 缺失时 generateSkillCover 回退 "?"。
  if (!url) {
    const { gradient, initials } = generateSkillCover(name ?? "");
    return (
      <span
        className="tc-agent-skill-row__cover flex items-center justify-center w-full h-full rounded-lg"
        style={{ background: gradient }}
        aria-hidden="true"
      >
        <span className="text-[28px] font-bold text-white/80 select-none">
          {initials}
        </span>
      </span>
    );
  }
  return (
    <span
      className="tc-agent-skill-row__cover block w-full h-full rounded-lg bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url("${url}")` }}
      aria-hidden="true"
    />
  );
}

export function UseButton({
  onClick,
  disabled = false,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="tc-agent-skill-row__action tc-agent-skill-row__action--use inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium text-white/80 border border-white/[0.08] hover:bg-white/[0.08] hover:text-white transition-colors disabled:opacity-40 disabled:pointer-events-none"
      onClick={onClick}
      disabled={disabled}
    >
      <AtSign size={12} aria-hidden="true" />
      <span>直接使用</span>
    </button>
  );
}
