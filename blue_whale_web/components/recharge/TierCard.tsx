"use client";
/**
 * TierCard — 单张套餐卡片（Qoder CN 定价页风格，美化版）
 *
 * 视觉层级：积分小标题 → 价格大字（视觉主角）→ 折扣徽标 → 权益三行 → 按钮。
 * 推荐卡：顶部 accent 色带 + 右上角徽标。
 * 选中态：border-2 accent + accent/10 背景 + 按钮带投影。
 * 未选中按钮：描边样式，hover 填充。
 */
import { Check } from "lucide-react";
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

/** 权益列表（三行） */
const TIER_BENEFITS = [
  "积分即时到账",
  "积分永久有效",
  "支持全部模型调用",
];

export function TierCard({ tier, isSelected, onSelect }: TierCardProps) {
  const hasDiscount = tier.discount < 1;

  return (
    <button
      type="button"
      onClick={() => onSelect(tier)}
      className={`
        group relative flex flex-col rounded-xl border p-5 pt-6 transition-all duration-150 text-left w-full overflow-hidden cursor-pointer
        ${
          isSelected
            ? "border-2 border-[var(--tc-accent,#3b82f6)] bg-[var(--tc-accent,#3b82f6)]/10 ring-1 ring-[var(--tc-ring,rgba(59,130,246,0.5))]"
            : "border border-[var(--tc-border,rgba(255,255,255,0.1))] bg-[var(--tc-bg-surface,#1a1a1a)] hover:border-[var(--tc-accent,#3b82f6)] hover:bg-[var(--tc-bg-elevated,#2a2a2a)]"
        }
        ${tier.isRecommended ? "border-t-2 border-t-[var(--tc-accent,#3b82f6)]" : ""}
      `}
    >
      {/* 推荐顶部色带 */}
      {tier.isRecommended && (
        <span className="absolute top-0 left-0 right-0 h-[2px] bg-[var(--tc-accent,#3b82f6)]" />
      )}

      {/* 推荐角标（右上角） */}
      {tier.isRecommended && (
        <span className="absolute top-3 right-3 inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-semibold bg-[var(--tc-accent,#3b82f6)] text-[var(--tc-on-accent,#ffffff)]">
          推荐
        </span>
      )}

      {/* 积分小标题 */}
      <p className="text-[13px] font-normal text-[var(--tc-secondary,rgba(255,255,255,0.7))]">
        {tier.amount.toLocaleString()} 积分
      </p>

      {/* 价格（视觉主角） + 折扣徽标 */}
      <div className="mt-1.5 flex items-baseline gap-2 flex-wrap">
        <span className="text-[30px] font-bold leading-none text-[var(--tc-accent,#3b82f6)]">
          ¥{tier.price}
        </span>
        {hasDiscount && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--tc-accent,#3b82f6)]/15 text-[var(--tc-accent,#3b82f6)]">
            {discountLabel(tier.discount)}
          </span>
        )}
      </div>
      {hasDiscount && (
        <p className="mt-0.5 text-[12px] text-[var(--tc-muted,rgba(255,255,255,0.4))] line-through">
          原价 ¥{tier.originalPrice}
        </p>
      )}

      {/* 权益列表（三行对勾） */}
      <ul className="mt-5 flex flex-col gap-2">
        {TIER_BENEFITS.map((b) => (
          <li
            key={b}
            className="flex items-center gap-2 text-[12px] text-[var(--tc-secondary,rgba(255,255,255,0.7))]"
          >
            <Check
              size={13}
              className="shrink-0 text-[var(--tc-accent,#3b82f6)]"
            />
            {b}
          </li>
        ))}
      </ul>
    </button>
  );
}
