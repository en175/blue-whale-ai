"use client";

import { useState, useEffect, useMemo } from "react";
import { Search, Eye, Coins, Lock, Unlock } from "lucide-react";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "../_components/ui/table";
import { Badge } from "../_components/ui/badge";
import { Dialog } from "../_components/ui/dialog";
import { Tabs } from "../_components/ui/tabs";
import { Input } from "../_components/ui/input";
import { Select } from "../_components/ui/select";
import type { AdminUserInfo, RechargeRecord, ConsumeRecord, AdjustLog, OperationLog } from "./_mock";
import { getUsers, adjustBalance, freezeUser, unfreezeUser, getRechargeRecords, getConsumeRecords, getAdjustLogs, getOperationLogs } from "./_mock";

const ROLE_LABELS: Record<number, string> = { 0: "普通用户", 100: "管理员" };
const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "active", label: "正常" },
  { value: "disabled", label: "已冻结" },
];
const BALANCE_RANGES = [
  { value: "all", label: "全部余额" },
  { value: "zero", label: "余额为 0" },
  { value: "low", label: "1 — 5,000" },
  { value: "mid", label: "5,000 — 50,000" },
  { value: "high", label: "> 50,000" },
];

const DETAIL_TABS = [
  { key: "info", label: "基本信息" },
  { key: "recharge", label: "充值记录" },
  { key: "consume", label: "消费记录" },
  { key: "adjust", label: "调整记录" },
  { key: "operations", label: "操作日志" },
];

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserInfo[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [balanceFilter, setBalanceFilter] = useState("all");

  const [detailUser, setDetailUser] = useState<AdminUserInfo | null>(null);
  const [detailTab, setDetailTab] = useState("info");
  const [recharges, setRecharges] = useState<RechargeRecord[]>([]);
  const [consumes, setConsumes] = useState<ConsumeRecord[]>([]);
  const [adjustLogs, setAdjustLogs] = useState<AdjustLog[]>([]);
  const [opLogs, setOpLogs] = useState<OperationLog[]>([]);

  const [adjustUser, setAdjustUser] = useState<AdminUserInfo | null>(null);
  const [adjustAmount, setAdjustAmount] = useState(0);
  const [adjustReason, setAdjustReason] = useState("");

  const [freezeUserTarget, setFreezeUserTarget] = useState<AdminUserInfo | null>(null);
  const [freezeReason, setFreezeReason] = useState("");
  const [unfreezeUserTarget, setUnfreezeUserTarget] = useState<AdminUserInfo | null>(null);
  const [unfreezeReason, setUnfreezeReason] = useState("");

  const [confirmMsg, setConfirmMsg] = useState("");

  useEffect(() => { setUsers(getUsers()); }, []);

  const filtered = useMemo(() => {
    let list = users;
    if (statusFilter !== "all") list = list.filter((u) => u.status === statusFilter);
    if (balanceFilter === "zero") list = list.filter((u) => u.balance === 0);
    else if (balanceFilter === "low") list = list.filter((u) => u.balance > 0 && u.balance <= 5000);
    else if (balanceFilter === "mid") list = list.filter((u) => u.balance > 5000 && u.balance <= 50000);
    else if (balanceFilter === "high") list = list.filter((u) => u.balance > 50000);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((u) => u.nickname.toLowerCase().includes(q) || u.phone.includes(q) || String(u.userId).includes(q));
    }
    return list;
  }, [users, search, statusFilter, balanceFilter]);

  const openDetail = (u: AdminUserInfo) => {
    setDetailUser(u); setDetailTab("info");
    setRecharges(getRechargeRecords(u.userId));
    setConsumes(getConsumeRecords(u.userId));
    setAdjustLogs(getAdjustLogs(u.userId));
    setOpLogs(getOperationLogs(u.userId));
  };

  const handleFreeze = () => {
    if (!freezeUserTarget || !freezeReason.trim()) return;
    const r = freezeUser(freezeUserTarget.userId, freezeReason.trim());
    if (r) { setUsers(getUsers()); setConfirmMsg(`用户 ${r.nickname} 已冻结`); setTimeout(() => setConfirmMsg(""), 2000); }
    setFreezeUserTarget(null); setFreezeReason("");
  };

  const handleUnfreeze = () => {
    if (!unfreezeUserTarget || !unfreezeReason.trim()) return;
    const r = unfreezeUser(unfreezeUserTarget.userId, unfreezeReason.trim());
    if (r) { setUsers(getUsers()); setConfirmMsg(`用户 ${r.nickname} 已解冻`); setTimeout(() => setConfirmMsg(""), 2000); }
    setUnfreezeUserTarget(null); setUnfreezeReason("");
  };

  const handleAdjust = () => {
    if (!adjustUser || adjustAmount === 0 || !adjustReason.trim()) return;
    adjustBalance(adjustUser.userId, adjustAmount, adjustReason.trim());
    setUsers(getUsers());
    setAdjustUser(null);
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[var(--tc-text-primary)]">用户管理</h1>
        <p className="mt-1 text-sm text-[var(--tc-text-muted)]">管理用户积分、查看充值消费明细、冻结/解冻账户</p>
      </div>

      {confirmMsg && (
        <div className="mb-4 rounded-lg bg-[#22c55e]/10 px-4 py-2 text-sm text-[#22c55e] border border-[#22c55e]/20">{confirmMsg}</div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--tc-text-muted)]" />
          <Input className="pl-9" placeholder="搜索昵称/手机号/用户ID..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} options={STATUS_OPTIONS} />
        <Select value={balanceFilter} onChange={(e) => setBalanceFilter(e.target.value)} options={BALANCE_RANGES} />
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
              <TableRow><TableCell colSpan={9} className="py-12 text-center text-[var(--tc-text-muted)]">暂无数据</TableCell></TableRow>
            ) : (
              filtered.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-mono text-xs text-[var(--tc-text-tertiary)]">#{u.userId}</TableCell>
                  <TableCell className="font-medium">{u.nickname}</TableCell>
                  <TableCell className="text-[var(--tc-text-secondary)]">{u.phone}</TableCell>
                  <TableCell className="font-mono font-medium">{u.balance.toLocaleString()}</TableCell>
                  <TableCell className="text-[var(--tc-text-secondary)]">{u.totalRecharge.toLocaleString()}</TableCell>
                  <TableCell className="text-[var(--tc-text-secondary)]">{u.totalSpend.toLocaleString()}</TableCell>
                  <TableCell><Badge variant={u.role >= 100 ? "destructive" : "secondary"}>{ROLE_LABELS[u.role] || "普通用户"}</Badge></TableCell>
                  <TableCell><Badge variant={u.status === "active" ? "success" : "secondary"}>{u.status === "active" ? "正常" : "已冻结"}</Badge></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openDetail(u)} className="rounded p-1.5 text-[var(--tc-text-muted)] hover:text-[var(--tc-text-primary)] hover:bg-[var(--tc-bg-elevated)]" title="详情"><Eye className="h-4 w-4" /></button>
                      <button onClick={() => setAdjustUser(u)} className="rounded p-1.5 text-[var(--tc-text-muted)] hover:text-[#22c55e] hover:bg-[#22c55e]/10" title="调整积分"><Coins className="h-4 w-4" /></button>
                      {u.status === "active" ? (
                        <button onClick={() => { setFreezeUserTarget(u); setFreezeReason(""); }} className="rounded p-1.5 text-[var(--tc-text-muted)] hover:text-[#f59e0b] hover:bg-[#f59e0b]/10" title="冻结账户"><Lock className="h-4 w-4" /></button>
                      ) : (
                        <button onClick={() => { setUnfreezeUserTarget(u); setUnfreezeReason(""); }} className="rounded p-1.5 text-[var(--tc-text-muted)] hover:text-[#22c55e] hover:bg-[#22c55e]/10" title="解冻账户"><Unlock className="h-4 w-4" /></button>
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
      <Dialog open={!!detailUser} onOpenChange={(o) => { if (!o) setDetailUser(null); }} title="用户详情" width={640}>
        {detailUser && (
          <div className="space-y-4">
            <Tabs tabs={DETAIL_TABS} active={detailTab} onChange={setDetailTab} />

            {detailTab === "info" && (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-[var(--tc-text-muted)]">用户ID</span><p className="font-medium">#{detailUser.userId}</p></div>
                <div><span className="text-[var(--tc-text-muted)]">昵称</span><p className="font-medium">{detailUser.nickname}</p></div>
                <div><span className="text-[var(--tc-text-muted)]">手机号</span><p className="font-medium">{detailUser.phone}</p></div>
                <div><span className="text-[var(--tc-text-muted)]">角色</span><p>{ROLE_LABELS[detailUser.role] || "普通用户"}</p></div>
                <div><span className="text-[var(--tc-text-muted)]">余额</span><p className="font-mono font-semibold">{detailUser.balance.toLocaleString()} 积分</p></div>
                <div><span className="text-[var(--tc-text-muted)]">状态</span><p><Badge variant={detailUser.status === "active" ? "success" : "secondary"}>{detailUser.status === "active" ? "正常" : "已冻结"}</Badge></p></div>
                <div><span className="text-[var(--tc-text-muted)]">注册时间</span><p className="text-[var(--tc-text-secondary)]">{new Date(detailUser.createdAt).toLocaleString("zh-CN")}</p></div>
                <div><span className="text-[var(--tc-text-muted)]">累计充值 / 消费</span><p className="text-[var(--tc-text-secondary)]">{detailUser.totalRecharge.toLocaleString()} / {detailUser.totalSpend.toLocaleString()}</p></div>
              </div>
            )}

            {detailTab === "recharge" && (
              <Table>
                <TableHeader><TableRow><TableHead>交易号</TableHead><TableHead>档位</TableHead><TableHead>金额</TableHead><TableHead>积分</TableHead><TableHead>方式</TableHead><TableHead>状态</TableHead><TableHead>创建时间</TableHead></TableRow></TableHeader>
                <TableBody>
                  {recharges.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center text-[var(--tc-text-muted)]">暂无充值记录</TableCell></TableRow> : recharges.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.tradeNo}</TableCell>
                      <TableCell className="text-sm">{r.tierName}</TableCell>
                      <TableCell>¥{r.amount}</TableCell>
                      <TableCell className="font-medium">{r.points.toLocaleString()}</TableCell>
                      <TableCell>{r.paymentMethod === "wechat" ? "微信" : "支付宝"}</TableCell>
                      <TableCell><Badge variant={r.status === "paid" ? "success" : "secondary"}>{r.status === "paid" ? "已支付" : "待支付"}</Badge></TableCell>
                      <TableCell className="text-xs text-[var(--tc-text-tertiary)]">{new Date(r.createdAt).toLocaleString("zh-CN")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {detailTab === "consume" && (
              <Table>
                <TableHeader><TableRow><TableHead>时间</TableHead><TableHead>类型</TableHead><TableHead>描述</TableHead><TableHead>消耗积分</TableHead><TableHead>参数快照</TableHead></TableRow></TableHeader>
                <TableBody>
                  {consumes.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-[var(--tc-text-muted)]">暂无消费记录</TableCell></TableRow> : consumes.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-xs text-[var(--tc-text-tertiary)]">{new Date(c.createdAt).toLocaleString("zh-CN")}</TableCell>
                      <TableCell><Badge variant={c.generationType === "image" ? "default" : "outline"}>{c.generationType === "image" ? "图片" : "视频"}</Badge></TableCell>
                      <TableCell className="text-sm">{c.description}</TableCell>
                      <TableCell className="font-medium text-[#ef4444]">-{c.points.toLocaleString()}</TableCell>
                      <TableCell className="max-w-[140px] truncate font-mono text-xs text-[var(--tc-text-muted)]">{JSON.stringify(c.paramsSnapshot)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {detailTab === "adjust" && (
              <Table>
                <TableHeader><TableRow><TableHead>时间</TableHead><TableHead>金额</TableHead><TableHead>原因</TableHead><TableHead>操作人</TableHead></TableRow></TableHeader>
                <TableBody>
                  {adjustLogs.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-[var(--tc-text-muted)]">暂无调整记录</TableCell></TableRow> : adjustLogs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs text-[var(--tc-text-tertiary)]">{new Date(l.createdAt).toLocaleString("zh-CN")}</TableCell>
                      <TableCell className={l.amount > 0 ? "text-[#22c55e]" : "text-[#ef4444]"}>{l.amount > 0 ? "+" : ""}{l.amount.toLocaleString()}</TableCell>
                      <TableCell>{l.reason}</TableCell>
                      <TableCell className="text-[var(--tc-text-tertiary)]">{l.operatorName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {detailTab === "operations" && (
              <Table>
                <TableHeader><TableRow><TableHead>时间</TableHead><TableHead>操作</TableHead><TableHead>详情</TableHead><TableHead>操作人</TableHead></TableRow></TableHeader>
                <TableBody>
                  {opLogs.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-[var(--tc-text-muted)]">暂无操作日志</TableCell></TableRow> : opLogs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs text-[var(--tc-text-tertiary)]">{new Date(l.createdAt).toLocaleString("zh-CN")}</TableCell>
                      <TableCell><Badge variant={l.action === "freeze" ? "destructive" : l.action === "unfreeze" ? "success" : "default"}>{l.action === "freeze" ? "冻结" : l.action === "unfreeze" ? "解冻" : "调整"}</Badge></TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">{JSON.stringify(l.detail)}</TableCell>
                      <TableCell className="text-[var(--tc-text-tertiary)]">{l.operatorName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </Dialog>

      {/* Adjust Dialog */}
      <Dialog open={!!adjustUser} onOpenChange={(o) => { if (!o) setAdjustUser(null); }} title="调整积分" width={400}>
        {adjustUser && (
          <div className="space-y-4">
            <div className="rounded-lg bg-[var(--tc-bg-elevated)] p-3 text-sm">
              <span className="text-[var(--tc-text-muted)]">用户：</span><span className="font-medium">{adjustUser.nickname}</span>
              <span className="ml-3 text-[var(--tc-text-muted)]">当前余额：</span><span className="font-mono font-semibold">{adjustUser.balance.toLocaleString()} 积分</span>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">调整金额（正数增加，负数扣减）</label>
              <Input type="number" value={adjustAmount} onChange={(e) => setAdjustAmount(Number(e.target.value) || 0)} placeholder="1000 或 -500" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">调整原因 <span className="text-[#ef4444]">*</span></label>
              <Input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="请输入原因（必填）" />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setAdjustUser(null)} className="rounded-lg border border-[var(--tc-border)] px-4 py-2 text-sm text-[var(--tc-text-secondary)] hover:bg-[var(--tc-bg-elevated)]">取消</button>
              <button onClick={handleAdjust} disabled={adjustAmount === 0 || !adjustReason.trim()} className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40 ${adjustAmount > 0 ? "bg-[#22c55e] hover:opacity-90" : "bg-[#ef4444] hover:opacity-90"}`}>
                {adjustAmount > 0 ? `+${adjustAmount} 积分` : adjustAmount < 0 ? `${adjustAmount} 积分` : "确认调整"}
              </button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Freeze Dialog */}
      <Dialog open={!!freezeUserTarget} onOpenChange={(o) => { if (!o) setFreezeUserTarget(null); }} title="冻结用户账户" width={400}>
        {freezeUserTarget && (
          <div className="space-y-4">
            <div className="rounded-lg bg-[#f59e0b]/10 border border-[#f59e0b]/20 p-3 text-sm text-[#f59e0b]">
              即将冻结 <span className="font-semibold">{freezeUserTarget.nickname}</span>（#{freezeUserTarget.userId}）的积分账户。冻结后该用户将无法充值和消费。
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">冻结原因 <span className="text-[#ef4444]">*</span></label>
              <Input value={freezeReason} onChange={(e) => setFreezeReason(e.target.value)} placeholder="请输入冻结原因（必填）" />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setFreezeUserTarget(null)} className="rounded-lg border border-[var(--tc-border)] px-4 py-2 text-sm text-[var(--tc-text-secondary)] hover:bg-[var(--tc-bg-elevated)]">取消</button>
              <button onClick={handleFreeze} disabled={!freezeReason.trim()} className="rounded-lg bg-[#f59e0b] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40">确认冻结</button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Unfreeze Dialog */}
      <Dialog open={!!unfreezeUserTarget} onOpenChange={(o) => { if (!o) setUnfreezeUserTarget(null); }} title="解冻用户账户" width={400}>
        {unfreezeUserTarget && (
          <div className="space-y-4">
            <div className="rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/20 p-3 text-sm text-[#22c55e]">
              即将解冻 <span className="font-semibold">{unfreezeUserTarget.nickname}</span>（#{unfreezeUserTarget.userId}）的积分账户。解冻后该用户将恢复正常充值消费。
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">解冻原因 <span className="text-[#ef4444]">*</span></label>
              <Input value={unfreezeReason} onChange={(e) => setUnfreezeReason(e.target.value)} placeholder="请输入解冻原因（必填）" />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setUnfreezeUserTarget(null)} className="rounded-lg border border-[var(--tc-border)] px-4 py-2 text-sm text-[var(--tc-text-secondary)] hover:bg-[var(--tc-bg-elevated)]">取消</button>
              <button onClick={handleUnfreeze} disabled={!unfreezeReason.trim()} className="rounded-lg bg-[#22c55e] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40">确认解冻</button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
