import { AtSign, X } from "lucide-react";

/** 「直接使用」一次性技能绑定标签（IK60WY）：技能名 + 移除按钮，颜色走 DESIGN token。 */
export default function DirectSkillTag({
  name,
  onRemove,
}: {
  name: string;
  onRemove: () => void;
}) {
  return (
    <span
      data-testid="direct-skill-tag"
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--tc-border-active)] bg-[var(--tc-bg-elevated)] py-1 pl-2.5 pr-1 text-xs text-[var(--tc-text-secondary)]"
    >
      <AtSign width={12} height={12} aria-hidden="true" />
      <span className="max-w-[200px] truncate">{name}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="移除技能标签"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--tc-text-muted)] transition-colors hover:bg-[var(--tc-menu-item-hover)] hover:text-[var(--tc-text-primary)]"
      >
        <X width={12} height={12} />
      </button>
    </span>
  );
}
