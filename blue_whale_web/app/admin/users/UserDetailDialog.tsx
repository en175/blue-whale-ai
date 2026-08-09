"use client";

// IK74V6：用户详情弹窗（从 page.tsx 下沉）。自管理明细 tab 与充值/消费筛选，
// 数据（充值/消费/调整/操作日志）由父组件加载后经 props 传入。

import { useState, useMemo } from "react";
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
import { Tabs } from "../_components/ui/tabs";
import { Input } from "../_components/ui/input";
import { Select } from "../_components/ui/select";
import type { AdminUserInfo } from "../_lib/admin-data";
import {
  ROLE_LABELS,
  DETAIL_TABS,
  RC_STATUS_OPTIONS,
  RC_PAYMENT_OPTIONS,
  CS_TYPE_OPTIONS,
  type AdjustLog,
  type OperationLog,
  type RechargeRecord,
  type ConsumeRecord,
} from "./lib";

export interface UserDetailDialogProps {
  user: AdminUserInfo | null;
  recharges: RechargeRecord[];
  consumes: ConsumeRecord[];
  adjustLogs: AdjustLog[];
  opLogs: OperationLog[];
  onClose: () => void;
}

export function UserDetailDialog({
  user,
  recharges,
  consumes,
  adjustLogs,
  opLogs,
  onClose,
}: UserDetailDialogProps) {
  const [detailTab, setDetailTab] = useState("info");
  const [rcDateFrom, setRcDateFrom] = useState("");
  const [rcDateTo, setRcDateTo] = useState("");
  const [rcStatus, setRcStatus] = useState("all");
  const [rcPayment, setRcPayment] = useState("all");
  const [csDateFrom, setCsDateFrom] = useState("");
  const [csDateTo, setCsDateTo] = useState("");
  const [csType, setCsType] = useState("all");

  const filteredRecharges = useMemo(() => {
    let list = recharges;
    if (rcStatus !== "all") list = list.filter((r) => r.status === rcStatus);
    if (rcPayment !== "all")
      list = list.filter((r) => r.paymentMethod === rcPayment);
    if (rcDateFrom) {
      const from = new Date(rcDateFrom).getTime();
      list = list.filter((r) => new Date(r.createdAt).getTime() >= from);
    }
    if (rcDateTo) {
      const to = new Date(rcDateTo).getTime() + 86400000;
      list = list.filter((r) => new Date(r.createdAt).getTime() <= to);
    }
    return list;
  }, [recharges, rcStatus, rcPayment, rcDateFrom, rcDateTo]);

  const filteredConsumes = useMemo(() => {
    let list = consumes;
    if (csType !== "all")
      list = list.filter((c) => c.generationType === csType);
    if (csDateFrom) {
      const from = new Date(csDateFrom).getTime();
      list = list.filter((c) => new Date(c.createdAt).getTime() >= from);
    }
    if (csDateTo) {
      const to = new Date(csDateTo).getTime() + 86400000;
      list = list.filter((c) => new Date(c.createdAt).getTime() <= to);
    }
    return list;
  }, [consumes, csType, csDateFrom, csDateTo]);

  return (
    <Dialog
      open={!!user}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="用户详情"
      width={700}
    >
      {user && (
        <div className="space-y-4">
          <Tabs
            tabs={DETAIL_TABS}
            active={detailTab}
            onChange={setDetailTab}
          />

          {detailTab === "info" && (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-[var(--tc-text-muted)]">用户ID</span>
                <p className="font-medium">#{user.userId}</p>
              </div>
              <div>
                <span className="text-[var(--tc-text-muted)]">昵称</span>
                <p className="font-medium">{user.nickname}</p>
              </div>
              <div>
                <span className="text-[var(--tc-text-muted)]">手机号</span>
                <p className="font-medium">{user.phone}</p>
              </div>
              <div>
                <span className="text-[var(--tc-text-muted)]">角色</span>
                <p>{ROLE_LABELS[user.role] || "普通用户"}</p>
              </div>
              <div>
                <span className="text-[var(--tc-text-muted)]">余额</span>
                <p className="font-mono font-semibold">
                  {user.balance.toLocaleString()} 积分
                </p>
              </div>
              <div>
                <span className="text-[var(--tc-text-muted)]">状态</span>
                <p>
                  <Badge
                    variant={user.status === "active" ? "success" : "secondary"}
                  >
                    {user.status === "active" ? "正常" : "已冻结"}
                  </Badge>
                </p>
              </div>
              <div>
                <span className="text-[var(--tc-text-muted)]">注册时间</span>
                <p className="text-[var(--tc-text-secondary)]">
                  {new Date(user.createdAt).toLocaleString("zh-CN")}
                </p>
              </div>
              <div>
                <span className="text-[var(--tc-text-muted)]">
                  累计充值 / 消费
                </span>
                <p className="text-[var(--tc-text-secondary)]">
                  {user.totalRecharge.toLocaleString()} /{" "}
                  {user.totalSpend.toLocaleString()}
                </p>
              </div>
            </div>
          )}

          {detailTab === "recharge" && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="w-32"
                  type="date"
                  value={rcDateFrom}
                  onChange={(e) => setRcDateFrom(e.target.value)}
                  placeholder="开始"
                />
                <span className="text-[var(--tc-text-muted)] text-xs">—</span>
                <Input
                  className="w-32"
                  type="date"
                  value={rcDateTo}
                  onChange={(e) => setRcDateTo(e.target.value)}
                  placeholder="结束"
                />
                <Select
                  value={rcStatus}
                  onChange={(e) => setRcStatus(e.target.value)}
                  options={RC_STATUS_OPTIONS}
                />
                <Select
                  value={rcPayment}
                  onChange={(e) => setRcPayment(e.target.value)}
                  options={RC_PAYMENT_OPTIONS}
                />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>交易号</TableHead>
                    <TableHead>档位</TableHead>
                    <TableHead>金额</TableHead>
                    <TableHead>积分</TableHead>
                    <TableHead>方式</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>创建时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRecharges.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center text-[var(--tc-text-muted)]"
                      >
                        暂无充值记录
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRecharges.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">
                          {r.tradeNo}
                        </TableCell>
                        <TableCell className="text-sm">{r.tierName}</TableCell>
                        <TableCell>¥{r.amount}</TableCell>
                        <TableCell className="font-medium">
                          {r.points.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {r.paymentMethod === "wechat" ? "微信" : "支付宝"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={r.status === "paid" ? "success" : "secondary"}
                          >
                            {r.status === "paid" ? "已支付" : "待支付"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-[var(--tc-text-tertiary)]">
                          {new Date(r.createdAt).toLocaleString("zh-CN")}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {detailTab === "consume" && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="w-32"
                  type="date"
                  value={csDateFrom}
                  onChange={(e) => setCsDateFrom(e.target.value)}
                  placeholder="开始"
                />
                <span className="text-[var(--tc-text-muted)] text-xs">—</span>
                <Input
                  className="w-32"
                  type="date"
                  value={csDateTo}
                  onChange={(e) => setCsDateTo(e.target.value)}
                  placeholder="结束"
                />
                <Select
                  value={csType}
                  onChange={(e) => setCsType(e.target.value)}
                  options={CS_TYPE_OPTIONS}
                />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>描述</TableHead>
                    <TableHead>消耗积分</TableHead>
                    <TableHead>参数快照</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredConsumes.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center text-[var(--tc-text-muted)]"
                      >
                        暂无消费记录
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredConsumes.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-xs text-[var(--tc-text-tertiary)]">
                          {new Date(c.createdAt).toLocaleString("zh-CN")}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              c.generationType === "image"
                                ? "default"
                                : "outline"
                            }
                          >
                            {c.generationType === "image" ? "图片" : "视频"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{c.description}</TableCell>
                        <TableCell className="font-medium text-[var(--tc-destructive)]">
                          -{c.points.toLocaleString()}
                        </TableCell>
                        <TableCell className="max-w-[140px] truncate font-mono text-xs text-[var(--tc-text-muted)]">
                          {JSON.stringify(c.paramsSnapshot)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {detailTab === "adjust" && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>金额</TableHead>
                  <TableHead>原因</TableHead>
                  <TableHead>操作人</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adjustLogs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center text-[var(--tc-text-muted)]"
                    >
                      暂无调整记录
                    </TableCell>
                  </TableRow>
                ) : (
                  adjustLogs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs text-[var(--tc-text-tertiary)]">
                        {new Date(l.createdAt).toLocaleString("zh-CN")}
                      </TableCell>
                      <TableCell
                        className={
                          l.amount > 0
                            ? "text-[var(--tc-success)]"
                            : "text-[var(--tc-destructive)]"
                        }
                      >
                        {l.amount > 0 ? "+" : ""}
                        {l.amount.toLocaleString()}
                      </TableCell>
                      <TableCell>{l.reason}</TableCell>
                      <TableCell className="text-[var(--tc-text-tertiary)]">
                        {l.operatorName}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}

          {detailTab === "operations" && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>操作</TableHead>
                  <TableHead>详情</TableHead>
                  <TableHead>操作人</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {opLogs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center text-[var(--tc-text-muted)]"
                    >
                      暂无操作日志
                    </TableCell>
                  </TableRow>
                ) : (
                  opLogs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs text-[var(--tc-text-tertiary)]">
                        {new Date(l.createdAt).toLocaleString("zh-CN")}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            l.action === "freeze"
                              ? "destructive"
                              : l.action === "unfreeze"
                                ? "success"
                                : "default"
                          }
                        >
                          {l.action === "freeze"
                            ? "冻结"
                            : l.action === "unfreeze"
                              ? "解冻"
                              : "调整"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">
                        {JSON.stringify(l.detail)}
                      </TableCell>
                      <TableCell className="text-[var(--tc-text-tertiary)]">
                        {l.operatorName}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </Dialog>
  );
}
