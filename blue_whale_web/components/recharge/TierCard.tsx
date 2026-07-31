"use client";
/**
 * TierCard — 单张档位卡片（对齐 admin/tiers 用户端预览布局）
 *
 * 左侧：积分数（大字）+ 折扣标签
 * 右侧：实付价格（accent）+ 原价划线
 * 选中态：accent 色边框 + 微弱背景高亮 + ✓ 标记
 */
import type { RechargeTier } from "./types";

interface TierCardProps {
  tier: RechargeTier;
  isSelected: boolean;
  onSelect: (tier: RechargeTier) => void;
}

/** 折扣显示：0.85 → "8.5折" */
function discountLabel(d: number): string {
  return `${Math.round(d * 100) / 10}折`;
}

export function TierCard({ tier, isSelected, onSelect }: TierCardProps) {
  const hasDiscount = tier.discount < 1;

  return (
    <button
      type="button"
      onClick={() => onSelect(tier)}
      className={`
        relative rounded-xl border p-4 transition-all duration-150 text-left w-full
        ${
          isSelected
            ? "border-[var(--tc-accent,#3b82f6)] bg-[var(--tc-accent,#3b82f6)]/8 ring-1 ring-[var(--tc-ring,rgba(59,130,246,0.5))]"
            : "border-[var(--tc-border-subtle,rgba(255,255,255,0.08))] bg-[var(--tc-bg-surface,#1a1a1a)] hover:border-[var(--tc-border-active,rgba(255,255,255,0.16))] hover:bg-[var(--tc-bg-elevated,#2a2a2a)]"
        }
      `}
    >
      {/* 推荐角标 */}
      {tier.isRecommended && (
        <span className="absolute -top-2.5 left-4 inline-flex items-center px-3 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--tc-accent,#3b82f6)] text-[var(--tc-on-accent,#ffffff)]">
          ⭐ 推荐
        </span>
      )}

      <div className="flex items-center justify-between">
        {/* 左侧：积分 + 折扣 */}
        <div>
          <div className="text-lg font-bold text-[var(--tc-primary,#ffffff)]">
            {tier.amount.toLocaleString()}{" "}
            <span className="text-sm font-normal text-[var(--tc-secondary,rgba(255,255,255,0.7))]">
              积分
            </span>
          </div>
          {hasDiscount && (
            <div className="mt-0.5 text-xs text-[var(--tc-success,#22c55e)]">
              {discountLabel(tier.discount)}优惠
            </div>
          )}
        </div>

        {/* 右侧：价格 + 选中标记 */}
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="flex items-baseline gap-1.5 justify-end">
              <span className="text-lg font-bold text-[var(--tc-accent,#3b82f6)]">
                ¥{tier.price}
              </span>
              {hasDiscount && (
                <span className="text-xs text-[var(--tc-muted,rgba(255,255,255,0.4))] line-through">
                  ¥{tier.originalPrice}
                </span>
              )}
            </div>
          </div>
          {isSelected && (
            <span className="text-[var(--tc-accent,#3b82f6)] text-[16px]">
              ✓
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
