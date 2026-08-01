"use client";

import { useState, useEffect } from "react";
import { Users, Coins, Receipt, TrendingUp, Clock } from "lucide-react";

type DashboardStats = {
  totalUsers: number;
  todayRecharge: number;
  todayRechargeCount: number;
  todaySpend: number;
  pendingOrders: number;
};

const MOCK_STATS: DashboardStats = {
  totalUsers: 2847,
  todayRecharge: 125600,
  todayRechargeCount: 143,
  todaySpend: 89200,
  pendingOrders: 7,
};

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

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setStats(MOCK_STATS), 200);
    return () => clearTimeout(t);
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
            {[
              { user: "user_***89", amount: 3000, time: "10 分钟前" },
              { user: "user_***42", amount: 6000, time: "25 分钟前" },
              { user: "user_***17", amount: 1000, time: "1 小时前" },
              { user: "user_***55", amount: 30000, time: "2 小时前" },
              { user: "user_***03", amount: 6000, time: "3 小时前" },
            ].map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-[var(--tc-text-secondary)]">
                  {item.user}
                </span>
                <span className="font-medium text-[var(--tc-text-primary)]">
                  +{item.amount.toLocaleString()} 积分
                </span>
                <span className="text-[var(--tc-text-muted)]">{item.time}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] p-5">
          <h2 className="mb-4 text-sm font-semibold text-[var(--tc-text-primary)]">
            最近消费
          </h2>
          <div className="space-y-3">
            {[
              {
                user: "user_***21",
                amount: 500,
                model: "gpt-4o",
                time: "15 分钟前",
              },
              {
                user: "user_***89",
                amount: 1200,
                model: "claude-sonnet-5",
                time: "30 分钟前",
              },
              {
                user: "user_***66",
                amount: 300,
                model: "gpt-4o-mini",
                time: "45 分钟前",
              },
              {
                user: "user_***42",
                amount: 800,
                model: "claude-fable-5",
                time: "1 小时前",
              },
              {
                user: "user_***34",
                amount: 2000,
                model: "claude-opus-5",
                time: "2 小时前",
              },
            ].map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-[var(--tc-text-secondary)]">
                  {item.user}
                </span>
                <span className="text-[var(--tc-text-tertiary)]">
                  {item.model}
                </span>
                <span className="font-medium text-[var(--tc-text-primary)]">
                  -{item.amount.toLocaleString()} 积分
                </span>
                <span className="text-[var(--tc-text-muted)]">{item.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
