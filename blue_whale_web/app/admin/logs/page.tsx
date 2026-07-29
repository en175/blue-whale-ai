"use client";

import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "../_components/ui/table";
import { Badge } from "../_components/ui/badge";
import { Input } from "../_components/ui/input";
import { Select } from "../_components/ui/select";
import type { AuditCategory } from "../_lib/audit-log";
import { getAuditLogs, AUDIT_CATEGORY_OPTIONS, CATEGORY_LABELS } from "../_lib/audit-log";

const CATEGORY_COLORS: Record<AuditCategory | "default", "success" | "default" | "secondary" | "destructive" | "outline"> = {
  pricing: "default",
  tier: "secondary",
  order: "outline",
  user: "success",
  default: "outline",
};

export default function AdminLogsPage() {
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchText, setSearchText] = useState("");

  const filtered = useMemo(() => {
    return getAuditLogs({ category: categoryFilter, dateFrom, dateTo, searchText });
  }, [categoryFilter, dateFrom, dateTo, searchText]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[var(--tc-text-primary)]">操作日志</h1>
        <p className="mt-1 text-sm text-[var(--tc-text-muted)]">管理操作审计记录，按类别和时间筛选</p>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} options={AUDIT_CATEGORY_OPTIONS} />
        <Input className="w-36" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder="开始日期" />
        <span className="text-[var(--tc-text-muted)]">—</span>
        <Input className="w-36" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder="结束日期" />
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--tc-text-muted)]" />
          <Input className="pl-9" placeholder="搜索目标/详情/操作人..." value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        </div>
      </div>

      <div className="rounded-xl border border-[var(--tc-border)] bg-[var(--tc-bg-surface)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>类别</TableHead>
              <TableHead>操作</TableHead>
              <TableHead>目标</TableHead>
              <TableHead>详情</TableHead>
              <TableHead>操作人</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-12 text-center text-[var(--tc-text-muted)]">暂无操作日志</TableCell></TableRow>
            ) : (
              filtered.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs text-[var(--tc-text-tertiary)] whitespace-nowrap">{new Date(l.createdAt).toLocaleString("zh-CN")}</TableCell>
                  <TableCell><Badge variant={CATEGORY_COLORS[l.category] || CATEGORY_COLORS.default}>{CATEGORY_LABELS[l.category]}</Badge></TableCell>
                  <TableCell className="font-medium text-sm">{l.action}</TableCell>
                  <TableCell className="text-sm text-[var(--tc-text-secondary)] max-w-[200px] truncate">{l.target}</TableCell>
                  <TableCell className="text-xs text-[var(--tc-text-tertiary)] max-w-[240px] truncate">{l.detail}</TableCell>
                  <TableCell className="text-sm">{l.operator}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
