"use client";

import { useState, useEffect, useMemo } from "react";
import { CheckCircle, Download, Search } from "lucide-react";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "../_components/ui/table";
import { Badge } from "../_components/ui/badge";
import { Dialog } from "../_components/ui/dialog";
import { Input } from "../_components/ui/input";
import { Select } from "../_components/ui/select";
import type { AdminOrder, OrderStatus, OperationLog } from "./_mock";
import { getOrders, confirmOrder, getOperationLogs, generateExportData, STATUS_LABELS } from "./_mock";

const STATUS_COLORS: Record<OrderStatus, "success" | "default" | "secondary" | "destructive" | "outline"> = {
  paid: "success", pending: "default", expired: "secondary", refunded: "destructive", failed: "outline",
};

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "pending", label: "待支付" },
  { value: "paid", label: "已支付" },
  { value: "expired", label: "已过期" },
  { value: "refunded", label: "已退款" },
  { value: "failed", label: "支付失败" },
];

const PAYMENT_OPTIONS = [
  { value: "all", label: "全部方式" },
  { value: "wechat", label: "微信支付" },
  { value: "alipay", label: "支付宝" },
];

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [userSearch, setUserSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [detailOrder, setDetailOrder] = useState<AdminOrder | null>(null);
  const [detailLogs, setDetailLogs] = useState<OperationLog[]>([]);

  const [confirmOrderTarget, setConfirmOrderTarget] = useState<AdminOrder | null>(null);
  const [confirmReason, setConfirmReason] = useState("");
  const [confirmMsg, setConfirmMsg] = useState("");

  useEffect(() => { setOrders(getOrders()); }, []);

  const filtered = useMemo(() => {
    let list = orders;
    if (statusFilter !== "all") list = list.filter((o) => o.status === statusFilter);
    if (paymentFilter !== "all") list = list.filter((o) => o.paymentMethod === paymentFilter);
    if (userSearch.trim()) {
      const q = userSearch.trim().toLowerCase();
      list = list.filter((o) => o.nickname.toLowerCase().includes(q) || o.phone.includes(q) || o.tradeNo.toLowerCase().includes(q));
    }
    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      list = list.filter((o) => new Date(o.createdAt).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo).getTime() + 86400000;
      list = list.filter((o) => new Date(o.createdAt).getTime() <= to);
    }
    return list;
  }, [orders, statusFilter, paymentFilter, userSearch, dateFrom, dateTo]);

  const openDetail = (o: AdminOrder) => { setDetailOrder(o); setDetailLogs(getOperationLogs(o.tradeNo)); };

  const handleConfirm = () => {
    if (!confirmOrderTarget || !confirmReason.trim()) return;
    const r = confirmOrder(confirmOrderTarget.tradeNo, confirmReason.trim());
    if (r) { setOrders(getOrders()); setConfirmMsg(`订单 ${r.tradeNo} 已手动确认，积分已到账`); setTimeout(() => setConfirmMsg(""), 2500); }
    setConfirmOrderTarget(null); setConfirmReason("");
  };

  const handleExport = () => {
    const csv = generateExportData(filtered);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `充值订单_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    setConfirmMsg("已导出当前筛选结果"); setTimeout(() => setConfirmMsg(""), 2000);
  };

  const pendingCount = filtered.filter((o) => o.status === "pending").length;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--tc-text-primary)]">订单管理</h1>
          <p className="mt-1 text-sm text-[var(--tc-text-muted)]">查看充值订单、支付链路、手动确认与导出</p>
        </div>
        <button onClick={handleExport} disabled={filtered.length === 0}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--tc-border)] px-4 py-2 text-sm font-medium text-[var(--tc-text-secondary)] hover:bg-[var(--tc-bg-elevated)] disabled:opacity-40 transition-colors">
          <Download className="h-4 w-4" />导出 Excel
        </button>
      </div>

      {confirmMsg && (
        <div className="mb-4 rounded-lg bg-[#22c55e]/10 px-4 py-2 text-sm text-[#22c55e] border border-[#22c55e]/20">{confirmMsg}</div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--tc-text-muted)]" />
          <Input className="pl-9" placeholder="搜索用户/手机号/交易号..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} options={STATUS_OPTIONS} />
        <Select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} options={PAYMENT_OPTIONS} />
        <Input className="w-36" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder="开始日期" />
        <span className="text-[var(--tc-text-muted)]">—</span>
        <Input className="w-36" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder="结束日期" />
        {pendingCount > 0 && <span className="ml-auto text-sm text-[var(--tc-text-muted)]">{pendingCount} 笔待处理</span>}
      </div>

      <div className="rounded-xl border border-[var(--tc-border)] bg-[var(--tc-bg-surface)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>交易号</TableHead>
              <TableHead>用户</TableHead>
              <TableHead>档位</TableHead>
              <TableHead>金额</TableHead>
              <TableHead>积分</TableHead>
              <TableHead>支付方式</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="py-12 text-center text-[var(--tc-text-muted)]">暂无订单</TableCell></TableRow>
            ) : (
              filtered.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-xs">
                    <button onClick={() => openDetail(o)} className="text-[var(--tc-accent,#3b82f6)] hover:underline text-left">
                      {o.tradeNo}
                    </button>
                  </TableCell>
                  <TableCell className="font-medium">{o.nickname}</TableCell>
                  <TableCell className="text-[var(--tc-text-secondary)] text-sm max-w-[160px] truncate">{o.tierName}</TableCell>
                  <TableCell>¥{o.price}</TableCell>
                  <TableCell>
                    <span className="font-medium">{o.points.toLocaleString()}</span>
                    {o.bonus > 0 && <span className="ml-1 text-xs text-[#22c55e]">+{o.bonus}</span>}
                  </TableCell>
                  <TableCell className="text-[var(--tc-text-secondary)]">{o.paymentMethod === "wechat" ? "微信" : "支付宝"}</TableCell>
                  <TableCell><Badge variant={STATUS_COLORS[o.status]}>{STATUS_LABELS[o.status]}</Badge></TableCell>
                  <TableCell className="text-xs text-[var(--tc-text-tertiary)]">{new Date(o.createdAt).toLocaleString("zh-CN")}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {o.status === "pending" && (
                        <button onClick={() => { setConfirmOrderTarget(o); setConfirmReason(""); }}
                          className="rounded p-1.5 text-[var(--tc-text-muted)] hover:text-[#22c55e] hover:bg-[#22c55e]/10" title="手动确认">
                          <CheckCircle className="h-4 w-4" />
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

      {/* Detail Drawer — payment chain */}
      <Dialog open={!!detailOrder} onOpenChange={(o) => { if (!o) setDetailOrder(null); }} title="订单详情 · 支付全链路" width={560}>
        {detailOrder && (
          <div className="space-y-6">
            {/* Payment chain visualization */}
            <div className="flex items-center gap-2 text-xs">
              {[
                { label: "创建订单", time: detailOrder.createdAt, done: true },
                { label: "发起支付", time: detailOrder.paidAt, done: !!detailOrder.paidAt },
                { label: "支付回调", time: detailOrder.arrivedAt, done: !!detailOrder.arrivedAt },
                { label: "积分到账", time: detailOrder.arrivedAt, done: detailOrder.status === "paid" },
              ].map((step, i) => (
                <div key={step.label} className="flex items-center gap-2">
                  <div className="flex flex-col items-center">
                    <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${step.done ? "bg-[#22c55e] text-white" : "bg-[var(--tc-bg-elevated)] text-[var(--tc-text-muted)]"}`}>
                      {step.done ? "✓" : i + 1}
                    </div>
                    <span className={`mt-1 text-[10px] ${step.done ? "text-[#22c55e]" : "text-[var(--tc-text-muted)]"}`}>{step.label}</span>
                  </div>
                  {i < 3 && <div className={`mb-5 h-px w-4 ${step.done ? "bg-[#22c55e]" : "bg-[var(--tc-border)]"}`} />}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-[var(--tc-text-muted)]">交易号</span><p className="font-mono text-xs">{detailOrder.tradeNo}</p></div>
              <div><span className="text-[var(--tc-text-muted)]">状态</span><p><Badge variant={STATUS_COLORS[detailOrder.status]}>{STATUS_LABELS[detailOrder.status]}</Badge></p></div>
              <div><span className="text-[var(--tc-text-muted)]">用户</span><p className="font-medium">{detailOrder.nickname} (#{detailOrder.userId})</p></div>
              <div><span className="text-[var(--tc-text-muted)]">手机号</span><p>{detailOrder.phone}</p></div>
              <div><span className="text-[var(--tc-text-muted)]">档位</span><p>{detailOrder.tierName}</p></div>
              <div><span className="text-[var(--tc-text-muted)]">金额</span><p className="font-semibold">¥{detailOrder.price}</p></div>
              <div><span className="text-[var(--tc-text-muted)]">购买积分</span><p className="font-mono">{detailOrder.points.toLocaleString()}</p></div>
              <div><span className="text-[var(--tc-text-muted)]">赠送积分</span><p className="font-mono text-[#22c55e]">+{detailOrder.bonus.toLocaleString()}</p></div>
              <div><span className="text-[var(--tc-text-muted)]">支付方式</span><p>{detailOrder.paymentMethod === "wechat" ? "微信支付" : "支付宝"}</p></div>
              <div><span className="text-[var(--tc-text-muted)]">支付平台流水号</span><p className="font-mono text-xs">{detailOrder.platformRefNo || "—"}</p></div>
              <div><span className="text-[var(--tc-text-muted)]">IP</span><p className="font-mono text-xs">{detailOrder.ip}</p></div>
              <div><span className="text-[var(--tc-text-muted)]">创建时间</span><p>{new Date(detailOrder.createdAt).toLocaleString("zh-CN")}</p></div>
              <div><span className="text-[var(--tc-text-muted)]">支付时间</span><p>{detailOrder.paidAt ? new Date(detailOrder.paidAt).toLocaleString("zh-CN") : "—"}</p></div>
              <div><span className="text-[var(--tc-text-muted)]">到账时间</span><p>{detailOrder.arrivedAt ? new Date(detailOrder.arrivedAt).toLocaleString("zh-CN") : "—"}</p></div>
            </div>

            {detailLogs.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-[var(--tc-text-primary)]">操作日志</h3>
                {detailLogs.map((l) => (
                  <div key={l.id} className="flex items-center justify-between rounded bg-[var(--tc-bg-elevated)] px-3 py-2 text-sm">
                    <span>{l.action === "confirm" ? "手动确认" : l.action} — {l.reason}</span>
                    <span className="text-xs text-[var(--tc-text-muted)]">{l.operatorName} · {new Date(l.createdAt).toLocaleString("zh-CN")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* Confirm Dialog */}
      <Dialog open={!!confirmOrderTarget} onOpenChange={(o) => { if (!o) setConfirmOrderTarget(null); }} title="手动确认订单" width={440}>
        {confirmOrderTarget && (
          <div className="space-y-4">
            <div className="rounded-lg bg-[var(--tc-bg-elevated)] p-3 text-sm space-y-1">
              <div><span className="text-[var(--tc-text-muted)]">交易号：</span><span className="font-mono">{confirmOrderTarget.tradeNo}</span></div>
              <div><span className="text-[var(--tc-text-muted)]">用户：</span><span>{confirmOrderTarget.nickname}</span></div>
              <div><span className="text-[var(--tc-text-muted)]">金额：</span><span className="font-semibold">¥{confirmOrderTarget.price}</span> — <span>{confirmOrderTarget.points.toLocaleString()} 积分{confirmOrderTarget.bonus > 0 ? ` (+${confirmOrderTarget.bonus} 赠送)` : ""}</span></div>
            </div>
            <div className="rounded-lg bg-[#f59e0b]/10 border border-[#f59e0b]/20 p-3 text-sm text-[#f59e0b]">
              确认后用户积分将立即到账。仅 pending 状态可确认。
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">确认原因 <span className="text-[#ef4444]">*</span></label>
              <Input value={confirmReason} onChange={(e) => setConfirmReason(e.target.value)} placeholder="请输入确认原因（必填），如：支付回调丢失、用户已付款截图" />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setConfirmOrderTarget(null)} className="rounded-lg border border-[var(--tc-border)] px-4 py-2 text-sm text-[var(--tc-text-secondary)] hover:bg-[var(--tc-bg-elevated)]">取消</button>
              <button onClick={handleConfirm} disabled={!confirmReason.trim()} className="rounded-lg bg-[#22c55e] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40">确认并到账</button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
