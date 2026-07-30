"use client";
/**
 * TierCard — 单张档位卡片
 *
 * 展示：价格（大字）、获得积分、赠送徽章、推荐角标。
 * 选中态：accent 色边框 + 微弱背景高亮。
 */
import type { RechargeTier } from "./types";

interface TierCardProps {
  tier: RechargeTier;
  isSelected: boolean;
  onSelect: (tier: RechargeTier) => void;
}

export function TierCard({ tier, isSelected, onSelect }: TierCardProps) {
  const hasBonus = tier.bonus > 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(tier)}
      className={`
        relative flex items-center gap-4 px-5 py-4 rounded-xl border transition-all duration-150
        ${
          isSelected
            ? "border-[var(--tc-accent,#3b82f6)] bg-[var(--tc-accent,#3b82f6)]/8 ring-1 ring-[var(--tc-ring,rgba(59,130,246,0.5))]"
            : "border-[var(--tc-border-subtle,rgba(255,255,255,0.08))] bg-[var(--tc-bg-surface,#1a1a1a)] hover:border-[var(--tc-border-active,rgba(255,255,255,0.16))] hover:bg-[var(--tc-bg-elevated,#2a2a2a)]"
        }
      `}
    >
      {/* 推荐角标 */}
      {tier.isRecommended && (
        <span className="absolute -top-1.5 right-3 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--tc-accent,#3b82f6)] text-[var(--tc-on-accent,#ffffff)]">
          推荐
        </span>
      )}

      {/* 赠送徽章 */}
      {hasBonus && (
        <span className="absolute top-3 left-3 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[var(--tc-success,#22c55e)]/15 text-[var(--tc-success,#22c55e)]">
          送 {tier.bonus}
        </span>
      )}

      {/* 左侧：价格 */}
      <span className="text-[26px] font-semibold leading-tight text-[var(--tc-primary,#ffffff)] min-w-[80px] text-left">
        ¥{tier.price}
      </span>

      {/* 右侧：积分信息 */}
      <div className="flex flex-col items-start gap-0.5 min-w-0">
        <span className="text-[14px] text-[var(--tc-secondary,rgba(255,255,255,0.7))]">
          {tier.amount.toLocaleString()} 积分
        </span>
        {hasBonus && (
          <span className="text-[12px] text-[var(--tc-success,#22c55e)]">
            含赠送 {tier.bonus.toLocaleString()} 积分
          </span>
        )}
      </div>

      {/* 选中标记 */}
      {isSelected && (
        <span className="ml-auto text-[var(--tc-accent,#3b82f6)] text-[18px]">
          ✓
        </span>
      )}
    </button>
  );
}
