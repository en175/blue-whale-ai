"use client";

import { useState, useEffect } from "react";
import { Users, Coins, Receipt, TrendingUp, Clock } from "lucide-react";
import { fetchDashboard, type DashboardStats } from "./_lib/admin-data";

const STAT_CARDS = [
  {
    key: "totalUsers",
    label: "总用户",
    icon: Users,
    prefix: "",
    suffix: " 人",
    color: "#3b82f6",
  },
  {
    key: "todayRecharge",
    label: "今日充值",
    icon: Coins,
    prefix: "",
    suffix: " 积分",
    color: "#22c55e",
  },
  {
    key: "todayRechargeCount",
    label: "今日充值笔数",
    icon: TrendingUp,
    prefix: "",
    suffix: " 笔",
    color: "#a855f7",
  },
  {
    key: "todaySpend",
    label: "今日消费",
    icon: Receipt,
    prefix: "",
    suffix: " 积分",
    color: "#f59e0b",
  },
  {
    key: "pendingOrders",
    label: "待处理订单",
    icon: Clock,
    prefix: "",
    suffix: " 笔",
    color: "#ef4444",
  },
] as const;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 0) return d.toLocaleString("zh-CN");
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return d.toLocaleDateString("zh-CN");
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);

  // IK6JXJ：真实统计（契约 4.6）。
  useEffect(() => {
    let cancelled = false;
    fetchDashboard()
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => {
        /* 静默：卡片保持骨架态 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-[var(--tc-text-primary)]">
          仪表盘
        </h1>
        <p className="mt-1 text-sm text-[var(--tc-text-muted)]">
          积分支付系统运行概览
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {STAT_CARDS.map(({ key, label, icon: Icon, suffix, color }) => (
          <div
            key={key}
            className="rounded-xl border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] p-5"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--tc-text-tertiary)]">
                {label}
              </span>
              <div
                className="flex h-9 w-9 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${color}15` }}
              >
                <Icon className="h-4 w-4" style={{ color }} />
              </div>
            </div>
            <div className="mt-3">
              {stats ? (
                <span className="text-2xl font-bold text-[var(--tc-text-primary)]">
                  {stats[key as keyof DashboardStats].toLocaleString()}
                  {suffix}
                </span>
              ) : (
                <div className="h-8 w-24 animate-pulse rounded bg-[var(--tc-bg-elevated)]" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Recent activity placeholder */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] p-5">
          <h2 className="mb-4 text-sm font-semibold text-[var(--tc-text-primary)]">
            最近充值
          </h2>
          <div className="space-y-3">
            {(stats?.recentRecharges ?? []).length === 0 ? (
              <div className="py-6 text-center text-sm text-[var(--tc-text-muted)]">
                暂无充值记录
              </div>
            ) : (
              (stats?.recentRecharges ?? []).map((item) => (
                <div
                  key={item.tradeNo}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-[var(--tc-text-secondary)]">
                    #{item.userId}
                  </span>
                  <span className="font-medium text-[var(--tc-text-primary)]">
                    +{item.amount.toLocaleString()} 积分
                  </span>
                  <span className="text-[var(--tc-text-muted)]">
                    {fmtTime(item.createdAt)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] p-5">
          <h2 className="mb-4 text-sm font-semibold text-[var(--tc-text-primary)]">
            最近消费
          </h2>
          <div className="space-y-3">
            {(stats?.recentConsumes ?? []).length === 0 ? (
              <div className="py-6 text-center text-sm text-[var(--tc-text-muted)]">
                暂无消费记录
              </div>
            ) : (
              (stats?.recentConsumes ?? []).map((item) => (
                <div
                  key={`${item.userId}-${item.createdAt}`}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-[var(--tc-text-secondary)]">
                    #{item.userId}
                  </span>
                  <span className="text-[var(--tc-text-tertiary)]">
                    {item.model}
                  </span>
                  <span className="font-medium text-[var(--tc-text-primary)]">
                    -{item.points.toLocaleString()} 积分
                  </span>
                  <span className="text-[var(--tc-text-muted)]">
                    {fmtTime(item.createdAt)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
