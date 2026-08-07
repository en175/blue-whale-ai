"use client";
/**
 * TierGrid — 套餐卡片网格（Qoder CN 风格横向多列）
 *
 * 状态：loading（骨架）| empty（插画）| error（重试）| normal（横向多列网格）。
 * 数据源：mock / 后端 getRechargeTiers()。
 */
import { useEffect, useState, useRef, type CSSProperties } from "react";
import { AlertCircle, Store } from "lucide-react";
import { TierCard } from "./TierCard";
import { getRechargeTiers } from "@/lib/api/recharge";
import type { RechargeTier, TierLoadState } from "./types";

interface TierGridProps {
  selectedTierId: string | null;
  onSelectTier: (tier: RechargeTier) => void;
  /** 档位加载完成后，自动选中首个满足条件的档位（仅触发一次，如不足拦截自动高亮） */
  autoSelectPredicate?: (tier: RechargeTier) => boolean;
  /** 紧凑模式：侧栏展开导致中栏变窄时降为 2 列，避免卡片挤压 */
  compact?: boolean;
}

export function TierGrid({
  selectedTierId,
  onSelectTier,
  autoSelectPredicate,
  compact = false,
}: TierGridProps) {
  const [tiers, setTiers] = useState<RechargeTier[]>([]);
  const [loadState, setLoadState] = useState<TierLoadState>("loading");
  const hasAutoSelectedRef = useRef(false);

  // 列数：紧凑模式（右栏展开）降为 2 列；常规模式按档位数单行横排（一列一个套餐，Qoder 风格）
  const gridCols = compact
    ? "grid grid-cols-1 sm:grid-cols-2 gap-6"
    : "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[repeat(var(--tier-cols,4),minmax(0,1fr))] gap-6";

  const fetchTiers = () => {
    setLoadState("loading");
    getRechargeTiers()
      .then((res) => {
        const mapped: RechargeTier[] = res.tiers.map((t) => ({
          id: t.id,
          name: t.name ?? `${t.amount.toLocaleString()} 积分`,
          amount: t.amount,
          originalPrice: t.original_price ?? t.price,
          discount: t.discount ?? 1,
          price: t.price,
          isRecommended: t.is_recommended,
          sortOrder: t.sort_order,
        }));
        mapped.sort((a, b) => a.sortOrder - b.sortOrder);
        setTiers(mapped);
        setLoadState(mapped.length === 0 ? "empty" : "normal");
      })
      .catch(() => {
        setLoadState("error");
      });
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTiers();
  }, []);

  // 不足拦截：档位加载完成后自动选中首个覆盖差额的档位（仅触发一次）
  useEffect(() => {
    if (
      !hasAutoSelectedRef.current &&
      loadState === "normal" &&
      tiers.length > 0 &&
      selectedTierId === null &&
      autoSelectPredicate
    ) {
      const match = tiers.find(autoSelectPredicate);
      if (match) {
        hasAutoSelectedRef.current = true;
        onSelectTier(match);
      }
    }
  }, [loadState, tiers, selectedTierId, autoSelectPredicate, onSelectTier]);

  return (
    <div className="flex flex-col gap-4 min-h-[300px]">
      <h3 className="text-[15px] font-medium text-[var(--tc-primary,#ffffff)]">
        请选择充值套餐
      </h3>

      {/* ---- loading: 骨架（单行横排，与正常态对齐） ---- */}
      {loadState === "loading" && (
        <div
          className={gridCols}
          style={compact ? undefined : ({ "--tier-cols": 4 } as CSSProperties)}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-3 p-5 pt-6 rounded-xl border border-[var(--tc-border-subtle,rgba(255,255,255,0.08))] bg-[var(--tc-bg-surface,#1a1a1a)] animate-pulse"
            >
              <div className="w-16 h-4 rounded bg-[var(--tc-bg-elevated,#2a2a2a)]" />
              <div className="w-24 h-7 rounded bg-[var(--tc-bg-elevated,#2a2a2a)]" />
              <div className="w-20 h-6 rounded bg-[var(--tc-bg-elevated,#2a2a2a)]" />
              <div className="flex-1" />
              <div className="w-full h-9 rounded-lg bg-[var(--tc-bg-elevated,#2a2a2a)]" />
            </div>
          ))}
        </div>
      )}

      {/* ---- empty ---- */}
      {loadState === "empty" && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <Store
            size={40}
            className="text-[var(--tc-muted,rgba(255,255,255,0.4))]"
          />
          <p className="text-[14px] text-[var(--tc-secondary,rgba(255,255,255,0.7))]">
            暂无可用充值档位
          </p>
          <p className="text-[12px] text-[var(--tc-muted,rgba(255,255,255,0.4))]">
            请稍后再试
          </p>
        </div>
      )}

      {/* ---- error ---- */}
      {loadState === "error" && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <AlertCircle
            size={40}
            className="text-[var(--tc-destructive,#ef4444)]"
          />
          <p className="text-[14px] text-[var(--tc-secondary,rgba(255,255,255,0.7))]">
            档位加载失败
          </p>
          <button
            type="button"
            onClick={fetchTiers}
            className="inline-flex items-center px-4 py-2 rounded-lg text-[13px] font-medium bg-[var(--tc-accent,#3b82f6)] text-[var(--tc-on-accent,#ffffff)] hover:opacity-90 transition-opacity"
          >
            重新加载
          </button>
        </div>
      )}

      {/* ---- normal: 单行横排，一列一个套餐（列数 = 档位数，窄屏降级 1/2 列） ---- */}
      {loadState === "normal" && (
        <div
          className={`${gridCols} items-stretch`}
          style={compact ? undefined : ({ "--tier-cols": tiers.length } as CSSProperties)}
        >
          {tiers.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              isSelected={selectedTierId === tier.id}
              onSelect={onSelectTier}
            />
          ))}
        </div>
      )}
    </div>
  );
}
