"use client";
/**
 * TierGrid — 左栏档位网格
 *
 * 状态：loading（骨架）| empty（插画）| error（重试）| normal（2 列网格）。
 * 数据源：mock / 后端 getRechargeTiers()。
 */
import { useEffect, useState, useRef } from "react";
import { AlertCircle, Store } from "lucide-react";
import { TierCard } from "./TierCard";
import { getRechargeTiers } from "@/lib/api/recharge";
import type { RechargeTier, TierLoadState } from "./types";

interface TierGridProps {
  selectedTierId: string | null;
  onSelectTier: (tier: RechargeTier) => void;
  /** 档位加载完成后，自动选中首个满足条件的档位（仅触发一次，如不足拦截自动高亮） */
  autoSelectPredicate?: (tier: RechargeTier) => boolean;
}

export function TierGrid({
  selectedTierId,
  onSelectTier,
  autoSelectPredicate,
}: TierGridProps) {
  const [tiers, setTiers] = useState<RechargeTier[]>([]);
  const [loadState, setLoadState] = useState<TierLoadState>("loading");
  const hasAutoSelectedRef = useRef(false);

  const fetchTiers = () => {
    setLoadState("loading");
    getRechargeTiers()
      .then((res) => {
        const mapped: RechargeTier[] = res.tiers.map((t) => ({
          id: t.id,
          amount: t.amount,
          price: t.price,
          bonus: t.bonus,
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
    fetchTiers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        选择充值金额
      </h3>

      {/* ---- loading: 骨架 ---- */}
      {loadState === "loading" && (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col items-center gap-3 p-4 rounded-xl border border-[var(--tc-border-subtle,rgba(255,255,255,0.08))] bg-[var(--tc-bg-surface,#1a1a1a)] animate-pulse"
            >
              <div className="w-16 h-5 rounded bg-[var(--tc-bg-elevated,#2a2a2a)]" />
              <div className="w-20 h-7 rounded bg-[var(--tc-bg-elevated,#2a2a2a)]" />
              <div className="w-12 h-4 rounded bg-[var(--tc-bg-elevated,#2a2a2a)]" />
            </div>
          ))}
        </div>
      )}

      {/* ---- empty ---- */}
      {loadState === "empty" && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <Store size={40} className="text-[var(--tc-muted,rgba(255,255,255,0.4))]" />
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

      {/* ---- normal: 2 列网格 ---- */}
      {loadState === "normal" && (
        <div className="grid grid-cols-2 gap-3">
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
