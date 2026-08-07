"use client";

import { AtSign } from "lucide-react";
import { generateMosaicCells } from "@/lib/skill-cover";

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
  // cover_url 有值 → 背景图；空 → 名称驱动的确定性像素马赛克（横版卡片改版定稿，
  // 个人技能默认配图统一为此样式），不依赖第三方外链占位图。
  if (!url) {
    const cells = generateMosaicCells(name ?? "");
    return (
      <span
        className="tc-agent-skill-row__cover grid grid-cols-6 grid-rows-6 w-full h-full overflow-hidden rounded-lg"
        aria-hidden="true"
      >
        {cells.map((color, i) => (
          <span key={i} style={{ background: color }} />
        ))}
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
