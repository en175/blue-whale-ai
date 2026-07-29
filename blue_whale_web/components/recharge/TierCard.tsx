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
        relative flex flex-col items-center gap-2 p-4 rounded-xl border text-center transition-all duration-150
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

      {/* 价格（大字） */}
      <span className="text-[28px] font-semibold leading-tight text-[var(--tc-primary,#ffffff)] mt-2">
        ¥{tier.price}
      </span>

      {/* 获得积分 */}
      <span className="text-[13px] text-[var(--tc-secondary,rgba(255,255,255,0.7))]">
        {tier.amount} 积分
      </span>

      {/* 赠送说明 */}
      {hasBonus && (
        <span className="text-[11px] text-[var(--tc-success,#22c55e)]">
          含赠送 {tier.bonus} 积分
        </span>
      )}
    </button>
  );
}
