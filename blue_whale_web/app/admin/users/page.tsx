"use client";

import { useState, useEffect, useMemo } from "react";
import { Search, Coins, Lock, Unlock } from "lucide-react";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "../_components/ui/table";
import { Badge } from "../_components/ui/badge";
import { Dialog } from "../_components/ui/dialog";
import { Input } from "../_components/ui/input";
import { Select } from "../_components/ui/select";
import { getAuditLogs } from "../_lib/audit-log";
import {
  fetchAdminUsers,
  manageUser,
  type AdminUserInfo,
} from "../_lib/admin-data";
import {
  ROLE_LABELS,
  STATUS_OPTIONS,
  BALANCE_PRESETS,
  loadBalanceState,
  saveBalanceState,
  toAdjustLog,
  toOperationLog,
  type AdjustLog,
  type OperationLog,
  type RechargeRecord,
  type ConsumeRecord,
} from "./lib";
import { UserDetailDialog } from "./UserDetailDialog";

export type {
  AdjustLog,
  OperationLog,
  RechargeRecord,
  ConsumeRecord,
} from "./lib";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserInfo[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Balance filter with localStorage
  const [balancePreset, setBalancePreset] = useState("all");
  const [balanceMin, setBalanceMin] = useState("");
  const [balanceMax, setBalanceMax] = useState("");

  // Restore balance filter on mount（setState 延后到宏任务，避开 effect 同步渲染规则）
  useEffect(() => {
    const saved = loadBalanceState();
    const timer = window.setTimeout(() => {
      setBalancePreset(saved.preset);
      setBalanceMin(saved.min);
      setBalanceMax(saved.max);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Persist balance filter changes to localStorage
  useEffect(() => {
    saveBalanceState({
      preset: balancePreset,
      min: balanceMin,
      max: balanceMax,
    });
  }, [balancePreset, balanceMin, balanceMax]);

  // Record filters

  const [detailUser, setDetailUser] = useState<AdminUserInfo | null>(null);
  const [recharges, setRecharges] = useState<RechargeRecord[]>([]);
  const [consumes, setConsumes] = useState<ConsumeRecord[]>([]);
  const [adjustLogs, setAdjustLogs] = useState<AdjustLog[]>([]);
  const [opLogs, setOpLogs] = useState<OperationLog[]>([]);

  const [adjustUser, setAdjustUser] = useState<AdminUserInfo | null>(null);
  const [adjustAmount, setAdjustAmount] = useState(0);
  const [adjustReason, setAdjustReason] = useState("");

  const [freezeUserTarget, setFreezeUserTarget] =
    useState<AdminUserInfo | null>(null);
  const [freezeReason, setFreezeReason] = useState("");
  const [unfreezeUserTarget, setUnfreezeUserTarget] =
    useState<AdminUserInfo | null>(null);
  const [unfreezeReason, setUnfreezeReason] = useState("");

  const [confirmMsg, setConfirmMsg] = useState("");

  // IK6JXJ：真实数据源（契约 4.2）。当前拉取前 100 条，搜索/状态/余额筛选本地进行。
  const loadUsers = async () => {
    try {
      const { list } = await fetchAdminUsers({ pageSize: 100 });
      setUsers(list);
    } catch (e) {
      setConfirmMsg(e instanceof Error ? e.message : "加载用户失败");
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetchAdminUsers({ pageSize: 100 })
      .then(({ list }) => {
        if (!cancelled) setUsers(list);
      })
      .catch((e) => {
        if (!cancelled)
          setConfirmMsg(e instanceof Error ? e.message : "加载用户失败");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    let list = users;
    if (statusFilter !== "all")
      list = list.filter((u) => u.status === statusFilter);

    // Balance filter
    if (balancePreset === "custom") {
      const mn = Number(balanceMin);
      const mx = Number(balanceMax);
      if (!isNaN(mn)) list = list.filter((u) => u.balance >= mn);
      if (!isNaN(mx)) list = list.filter((u) => u.balance <= mx);
    } else if (balancePreset !== "all") {
      if (balancePreset === "50000+") {
        list = list.filter((u) => u.balance > 50000);
      } else {
        const [lo, hi] = balancePreset.split("-").map(Number);
        list = list.filter((u) => u.balance >= lo && u.balance <= hi);
      }
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (u) =>
          u.nickname.toLowerCase().includes(q) ||
          u.phone.includes(q) ||
          String(u.userId).includes(q),
      );
    }
    return list;
  }, [users, search, statusFilter, balancePreset, balanceMin, balanceMax]);


  const openDetail = async (u: AdminUserInfo) => {
    setDetailUser(u);
    // 充值/消费明细：后端暂无按用户维度查询接口（IK6JXJ 契约说明），置空。
    setRecharges([]);
    setConsumes([]);
    // 调整/操作日志：复用 admin_operation_logs（target 为 `user:{id}`）。
    setAdjustLogs([]);
    setOpLogs([]);
    try {
      const rows = await getAuditLogs({
        category: "user",
        searchText: `user:${u.userId}`,
      });
      setAdjustLogs(
        rows
          .filter((r) => r.action === "user.adjust_balance")
          .map((r) => toAdjustLog(r, u.userId)),
      );
      setOpLogs(rows.map((r) => toOperationLog(r, u.userId)));
    } catch {
      /* 审计查询失败静默，tab 保持空态 */
    }
  };

  const handleFreeze = async () => {
    if (!freezeUserTarget || !freezeReason.trim()) return;
    try {
      await manageUser(freezeUserTarget.userId, "freeze", freezeReason.trim());
      setConfirmMsg(`用户 ${freezeUserTarget.nickname} 已冻结`);
      await loadUsers();
    } catch (e) {
      setConfirmMsg(e instanceof Error ? e.message : "冻结失败");
    }
    setTimeout(() => setConfirmMsg(""), 2000);
    setFreezeUserTarget(null);
    setFreezeReason("");
  };

  const handleUnfreeze = async () => {
    if (!unfreezeUserTarget || !unfreezeReason.trim()) return;
    try {
      await manageUser(
        unfreezeUserTarget.userId,
        "unfreeze",
        unfreezeReason.trim(),
      );
      setConfirmMsg(`用户 ${unfreezeUserTarget.nickname} 已解冻`);
      await loadUsers();
    } catch (e) {
      setConfirmMsg(e instanceof Error ? e.message : "解冻失败");
    }
    setTimeout(() => setConfirmMsg(""), 2000);
    setUnfreezeUserTarget(null);
    setUnfreezeReason("");
  };

  const handleAdjust = async () => {
    if (!adjustUser || adjustAmount === 0 || !adjustReason.trim()) return;
    try {
      await manageUser(
        adjustUser.userId,
        "adjustBalance",
        adjustReason.trim(),
        adjustAmount,
      );
      setConfirmMsg(`用户 ${adjustUser.nickname} 余额已调整`);
      await loadUsers();
    } catch (e) {
      setConfirmMsg(e instanceof Error ? e.message : "调整失败");
    }
    setTimeout(() => setConfirmMsg(""), 2000);
    setAdjustUser(null);
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[var(--tc-text-primary)]">
          用户管理
        </h1>
        <p className="mt-1 text-sm text-[var(--tc-text-muted)]">
          管理用户积分、查看充值消费明细、冻结/解冻账户
        </p>
      </div>

      {confirmMsg && (
        <div className="mb-4 rounded-lg bg-[#22c55e]/10 px-4 py-2 text-sm text-[#22c55e] border border-[#22c55e]/20">
          {confirmMsg}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--tc-text-muted)]" />
          <Input
            className="pl-9"
            placeholder="搜索昵称/手机号/用户ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          options={STATUS_OPTIONS}
        />
        <Select
          value={balancePreset}
          onChange={(e) => setBalancePreset(e.target.value)}
          options={BALANCE_PRESETS}
        />
        {balancePreset === "custom" && (
          <>
            <Input
              className="w-24"
              type="number"
              value={balanceMin}
              onChange={(e) => setBalanceMin(e.target.value)}
              placeholder="最小值"
            />
            <span className="text-[var(--tc-text-muted)]">—</span>
            <Input
              className="w-24"
              type="number"
              value={balanceMax}
              onChange={(e) => setBalanceMax(e.target.value)}
              placeholder="最大值"
            />
          </>
        )}
      </div>

      <div className="rounded-xl border border-[var(--tc-border)] bg-[var(--tc-bg-surface)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户ID</TableHead>
              <TableHead>昵称</TableHead>
              <TableHead>手机号</TableHead>
              <TableHead>余额</TableHead>
              <TableHead>累计充值</TableHead>
              <TableHead>累计消费</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-12 text-center text-[var(--tc-text-muted)]"
                >
                  暂无数据
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((u) => (
                <TableRow key={u.userId}>
                  <TableCell className="font-mono text-xs text-[var(--tc-text-tertiary)]">
                    #{u.userId}
                  </TableCell>
                  <TableCell className="font-medium">
                    <button
                      onClick={() => openDetail(u)}
                      className="text-[var(--tc-accent,#3b82f6)] hover:underline text-left"
                    >
                      {u.nickname}
                    </button>
                  </TableCell>
                  <TableCell className="text-[var(--tc-text-secondary)]">
                    {u.phone}
                  </TableCell>
                  <TableCell className="font-mono font-medium">
                    {u.balance.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-[var(--tc-text-secondary)]">
                    {u.totalRecharge.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-[var(--tc-text-secondary)]">
                    {u.totalSpend.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={u.role >= 100 ? "destructive" : "secondary"}
                    >
                      {ROLE_LABELS[u.role] || "普通用户"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={u.status === "active" ? "success" : "secondary"}
                    >
                      {u.status === "active" ? "正常" : "已冻结"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setAdjustUser(u)}
                        className="rounded p-1.5 text-[var(--tc-text-muted)] hover:text-[#22c55e] hover:bg-[#22c55e]/10"
                        title="调整积分"
                      >
                        <Coins className="h-4 w-4" />
                      </button>
                      {u.status === "active" ? (
                        <button
                          onClick={() => {
                            setFreezeUserTarget(u);
                            setFreezeReason("");
                          }}
                          className="rounded p-1.5 text-[var(--tc-text-muted)] hover:text-[#f59e0b] hover:bg-[#f59e0b]/10"
                          title="冻结账户"
                        >
                          <Lock className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setUnfreezeUserTarget(u);
                            setUnfreezeReason("");
                          }}
                          className="rounded p-1.5 text-[var(--tc-text-muted)] hover:text-[#22c55e] hover:bg-[#22c55e]/10"
                          title="解冻账户"
                        >
                          <Unlock className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Detail Drawer with Tabs */}
      <UserDetailDialog
        user={detailUser}
        recharges={recharges}
        consumes={consumes}
        adjustLogs={adjustLogs}
        opLogs={opLogs}
        onClose={() => setDetailUser(null)}
      />

      {/* Adjust Dialog */}
      <Dialog
        open={!!adjustUser}
        onOpenChange={(o) => {
          if (!o) setAdjustUser(null);
        }}
        title="调整积分"
        width={400}
      >
        {adjustUser && (
          <div className="space-y-4">
            <div className="rounded-lg bg-[var(--tc-bg-elevated)] p-3 text-sm">
              <span className="text-[var(--tc-text-muted)]">用户：</span>
              <span className="font-medium">{adjustUser.nickname}</span>
              <span className="ml-3 text-[var(--tc-text-muted)]">
                当前余额：
              </span>
              <span className="font-mono font-semibold">
                {adjustUser.balance.toLocaleString()} 积分
              </span>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                调整金额（正数增加，负数扣减）
              </label>
              <Input
                type="number"
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(Number(e.target.value) || 0)}
                placeholder="1000 或 -500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                调整原因 <span className="text-[#ef4444]">*</span>
              </label>
              <Input
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="请输入原因（必填）"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setAdjustUser(null)}
                className="rounded-lg border border-[var(--tc-border)] px-4 py-2 text-sm text-[var(--tc-text-secondary)] hover:bg-[var(--tc-bg-elevated)]"
              >
                取消
              </button>
              <button
                onClick={handleAdjust}
                disabled={adjustAmount === 0 || !adjustReason.trim()}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40 ${adjustAmount > 0 ? "bg-[#22c55e] hover:opacity-90" : "bg-[#ef4444] hover:opacity-90"}`}
              >
                {adjustAmount > 0
                  ? `+${adjustAmount} 积分`
                  : adjustAmount < 0
                    ? `${adjustAmount} 积分`
                    : "确认调整"}
              </button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Freeze Dialog */}
      <Dialog
        open={!!freezeUserTarget}
        onOpenChange={(o) => {
          if (!o) setFreezeUserTarget(null);
        }}
        title="冻结用户账户"
        width={400}
      >
        {freezeUserTarget && (
          <div className="space-y-4">
            <div className="rounded-lg bg-[#f59e0b]/10 border border-[#f59e0b]/20 p-3 text-sm text-[#f59e0b]">
              即将冻结{" "}
              <span className="font-semibold">{freezeUserTarget.nickname}</span>
              （#{freezeUserTarget.userId}
              ）的积分账户。冻结后该用户将无法充值和消费。
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                冻结原因 <span className="text-[#ef4444]">*</span>
              </label>
              <Input
                value={freezeReason}
                onChange={(e) => setFreezeReason(e.target.value)}
                placeholder="请输入冻结原因（必填）"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setFreezeUserTarget(null)}
                className="rounded-lg border border-[var(--tc-border)] px-4 py-2 text-sm text-[var(--tc-text-secondary)] hover:bg-[var(--tc-bg-elevated)]"
              >
                取消
              </button>
              <button
                onClick={handleFreeze}
                disabled={!freezeReason.trim()}
                className="rounded-lg bg-[#f59e0b] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                确认冻结
              </button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Unfreeze Dialog */}
      <Dialog
        open={!!unfreezeUserTarget}
        onOpenChange={(o) => {
          if (!o) setUnfreezeUserTarget(null);
        }}
        title="解冻用户账户"
        width={400}
      >
        {unfreezeUserTarget && (
          <div className="space-y-4">
            <div className="rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/20 p-3 text-sm text-[#22c55e]">
              即将解冻{" "}
              <span className="font-semibold">
                {unfreezeUserTarget.nickname}
              </span>
              （#{unfreezeUserTarget.userId}
              ）的积分账户。解冻后该用户将恢复正常充值消费。
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                解冻原因 <span className="text-[#ef4444]">*</span>
              </label>
              <Input
                value={unfreezeReason}
                onChange={(e) => setUnfreezeReason(e.target.value)}
                placeholder="请输入解冻原因（必填）"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setUnfreezeUserTarget(null)}
                className="rounded-lg border border-[var(--tc-border)] px-4 py-2 text-sm text-[var(--tc-text-secondary)] hover:bg-[var(--tc-bg-elevated)]"
              >
                取消
              </button>
              <button
                onClick={handleUnfreeze}
                disabled={!unfreezeReason.trim()}
                className="rounded-lg bg-[#22c55e] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                确认解冻
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
