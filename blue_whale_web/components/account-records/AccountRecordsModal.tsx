"use client";
/**
 * AccountRecordsModal —— 账户记录弹窗（IK39UR）。
 *
 * 账户中心查看充值记录 + 消费记录：双 Tab 切换，各自独立拉取
 * /api/account/topups、/api/account/consumptions（BFF 转发 Go，时间倒序）。
 * 充值行：收入图标 + 获得积分 + 实付/支付方式 + 三态徽标 + 相对时间；
 * 消费行：支出图标 + 消耗积分 + 生成内容摘要 + 相对时间。
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Sparkles, Wallet } from "lucide-react";

import { ModalShell } from "@/components/auth/ModalShell";
import {
  getConsumptionRecords,
  getRechargeRecords,
} from "@/lib/api/account-records";
import type {
  ConsumptionRecordDto,
  RechargeRecordDto,
} from "@/lib/api/account-records.dto";
import { formatRelativeTime } from "@/lib/relative-time";
import { formatCredits } from "@/lib/credits";

interface AccountRecordsModalProps {
  onClose: () => void;
}

type Tab = "recharge" | "consumption";

type LoadState<T> =
  | { phase: "loading" }
  | { phase: "ready"; items: T }
  | { phase: "error"; message: string };

const PAGE_SIZE = 20;

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/** 充值三态徽标（设计系统状态色：success / destructive / accent 进行中）。 */
function StatusBadge({ status }: { status: RechargeRecordDto["status"] }) {
  const config = {
    success: {
      label: "成功",
      className:
        "bg-[var(--tc-success,#22c55e)]/15 text-[var(--tc-success,#22c55e)]",
    },
    failed: {
      label: "失败",
      className:
        "bg-[var(--tc-destructive,#ef4444)]/15 text-[var(--tc-destructive,#ef4444)]",
    },
    pending: {
      label: "进行中",
      className:
        "bg-[var(--tc-accent,#3b82f6)]/15 text-[var(--tc-accent,#3b82f6)]",
    },
  }[status];
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] leading-none ${config.className}`}
    >
      {config.label}
    </span>
  );
}

function RechargeRow({ record }: { record: RechargeRecordDto }) {
  return (
    <li className="flex items-center gap-3 py-3 border-b border-white/[0.06] last:border-0">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--tc-success,#22c55e)]/15">
        <ArrowDown size={16} className="text-[var(--tc-success,#22c55e)]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[14px] font-semibold text-white tabular-nums">
          +{formatCredits(record.credits)} 积分
        </span>
        <span className="flex items-center gap-2 text-[12px] text-white/55">
          <span className="tabular-nums">
            ¥{record.amount_cny.toFixed(2)} {record.payment_method}
          </span>
          <StatusBadge status={record.status} />
        </span>
      </span>
      <span className="shrink-0 text-[12px] text-white/45">
        {formatRelativeTime(record.created_at)}
      </span>
    </li>
  );
}

function ConsumptionRow({ record }: { record: ConsumptionRecordDto }) {
  return (
    <li className="flex items-center gap-3 py-3 border-b border-white/[0.06] last:border-0">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--tc-destructive,#ef4444)]/15">
        <ArrowUp size={16} className="text-[var(--tc-destructive,#ef4444)]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[14px] font-semibold text-white tabular-nums">
          -{formatCredits(record.credits)} 积分
        </span>
        <span className="truncate text-[12px] text-white/55">
          {record.summary}
        </span>
      </span>
      <span className="shrink-0 text-[12px] text-white/45">
        {formatRelativeTime(record.created_at)}
      </span>
    </li>
  );
}

function SkeletonRows() {
  return (
    <div aria-hidden="true" className="flex flex-col">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 py-3">
          <span className="h-9 w-9 rounded-full bg-white/[0.08]" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-3.5 w-24 rounded bg-white/[0.08]" />
            <span className="h-3 w-32 rounded bg-white/[0.06]" />
          </span>
          <span className="h-3 w-14 rounded bg-white/[0.06]" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="py-10 text-center text-[13px] text-white/45">{text}</p>;
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-10">
      <p className="text-[13px] text-[var(--tc-destructive,#ef4444)]">
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-white/[0.12] px-3 py-1.5 text-[12px] text-white/80 transition-colors hover:bg-white/[0.06]"
      >
        重试
      </button>
    </div>
  );
}

export function AccountRecordsModal({ onClose }: AccountRecordsModalProps) {
  const [tab, setTab] = useState<Tab>("recharge");
  const [recharge, setRecharge] = useState<LoadState<RechargeRecordDto[]>>(
    () => ({ phase: "loading" }),
  );
  const [consumption, setConsumption] = useState<LoadState<
    ConsumptionRecordDto[]
  > | null>(null);
  const [rechargeAttempt, setRechargeAttempt] = useState(0);

  // 打开即拉充值记录；setState 都在 await 之后（避免 effect 内同步 setState）
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getRechargeRecords(1, PAGE_SIZE);
        if (active) setRecharge({ phase: "ready", items: data.items });
      } catch (e) {
        if (active)
          setRecharge({
            phase: "error",
            message: errorMessage(e, "充值记录加载失败"),
          });
      }
    })();
    return () => {
      active = false;
    };
  }, [rechargeAttempt]);

  const retryRecharge = useCallback(() => {
    setRecharge({ phase: "loading" });
    setRechargeAttempt((n) => n + 1);
  }, []);

  /** 消费记录按需拉取：切 Tab（首次）/ 重试时在事件处理器里发起 */
  const loadConsumption = useCallback(async () => {
    try {
      const data = await getConsumptionRecords(1, PAGE_SIZE);
      setConsumption({ phase: "ready", items: data.items });
    } catch (e) {
      setConsumption({
        phase: "error",
        message: errorMessage(e, "消费记录加载失败"),
      });
    }
  }, []);

  const switchTab = useCallback(
    (next: Tab) => {
      setTab(next);
      if (next === "consumption" && consumption === null) {
        setConsumption({ phase: "loading" });
        void loadConsumption();
      }
    },
    [consumption, loadConsumption],
  );

  const retryConsumption = useCallback(() => {
    setConsumption({ phase: "loading" });
    void loadConsumption();
  }, [loadConsumption]);

  const tabs: Array<{
    key: Tab;
    label: string;
    icon: typeof Wallet;
  }> = [
    { key: "recharge", label: "充值记录", icon: Wallet },
    { key: "consumption", label: "消费记录", icon: Sparkles },
  ];

  return (
    <ModalShell ariaLabel="账户记录" onClose={onClose} width={440}>
      <h2 className="mb-5 text-center text-[20px] font-semibold leading-tight text-white">
        账户记录
      </h2>

      <div
        role="tablist"
        aria-label="记录类型"
        className="mb-3 flex gap-1 rounded-lg bg-white/[0.05] p-1"
      >
        {tabs.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => switchTab(key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-[13px] transition-colors ${
                active
                  ? "bg-[var(--tc-bg-elevated,#2a2a2a)] font-medium text-white"
                  : "text-white/55 hover:text-white/80"
              }`}
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        aria-label={tab === "recharge" ? "充值记录列表" : "消费记录列表"}
        className="max-h-[340px] overflow-y-auto"
      >
        {tab === "recharge" ? (
          recharge.phase === "loading" ? (
            <SkeletonRows />
          ) : recharge.phase === "error" ? (
            <ErrorState message={recharge.message} onRetry={retryRecharge} />
          ) : recharge.items.length === 0 ? (
            <EmptyState text="暂无充值记录" />
          ) : (
            <ul>
              {recharge.items.map((record) => (
                <RechargeRow key={record.trade_no} record={record} />
              ))}
            </ul>
          )
        ) : !consumption || consumption.phase === "loading" ? (
          <SkeletonRows />
        ) : consumption.phase === "error" ? (
          <ErrorState
            message={consumption.message}
            onRetry={retryConsumption}
          />
        ) : consumption.items.length === 0 ? (
          <EmptyState text="暂无消费记录" />
        ) : (
          <ul>
            {consumption.items.map((record) => (
              <ConsumptionRow key={record.id} record={record} />
            ))}
          </ul>
        )}
      </div>

      <p className="mt-4 text-center text-[12px] text-white/40">
        记录按时间倒序排列
      </p>
    </ModalShell>
  );
}
