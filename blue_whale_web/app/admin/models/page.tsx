"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "../_components/ui/table";
import { Badge } from "../_components/ui/badge";
import { Tabs } from "../_components/ui/tabs";
import { getModels, type AdminModelRow } from "../_lib/admin-models";

/** capability_type → tab 元数据。text 预留供后续 agent 文生文选型（IK6T46）。 */
const TYPE_TABS = [
  { key: "image", label: "图片" },
  { key: "video", label: "视频" },
  { key: "text", label: "文生文" },
];

const TYPE_LABEL: Record<string, string> = {
  image: "图片",
  video: "视频",
  text: "文生文",
};

/** 默认参数摘要：图片显示尺寸档，视频显示时长档，文生文无媒体参数 → —。 */
function defaultSummary(m: AdminModelRow): string {
  if (m.capability_type === "text") return "—";
  if (m.capability_type === "video") {
    if (m.default_duration != null) return `${m.default_duration}s`;
    const sizes = Array.isArray(m.supported_sizes)
      ? m.supported_sizes.map((s: { id?: string }) => s.id).join(" / ")
      : "";
    return sizes || "—";
  }
  const parts = [m.default_size, m.default_aspect_ratio];
  return parts.filter(Boolean).join(" · ") || "—";
}

export default function AdminModelsPage() {
  const [models, setModels] = useState<AdminModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeType, setActiveType] = useState("image");

  const load = useCallback(async () => {
    try {
      setModels(await getModels());
    } catch (e) {
      console.error("加载模型目录失败", e);
      setError(e instanceof Error ? e.message : "加载模型目录失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const filtered = models.filter((m) => m.capability_type === activeType);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[var(--tc-text-primary)]">
          模型列表
        </h1>
        <p className="mt-1 text-sm text-[var(--tc-text-muted)]">
          管理前端 dock
          展示与后端调用所依赖的模型能力目录（generation_model_capability）
        </p>
      </div>

      <div className="mb-4">
        <Tabs tabs={TYPE_TABS} active={activeType} onChange={setActiveType} />
      </div>

      <div className="rounded-xl border border-[var(--tc-border)] bg-[var(--tc-bg-surface)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>模型 ID</TableHead>
              <TableHead>供应商</TableHead>
              <TableHead>展示名</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>默认参数</TableHead>
              <TableHead>启用</TableHead>
              <TableHead>排序</TableHead>
              <TableHead>更新时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-12 text-center text-[var(--tc-destructive)]"
                >
                  加载失败：{error}
                </TableCell>
              </TableRow>
            ) : loading ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-12 text-center text-[var(--tc-text-muted)]"
                >
                  加载中…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-12 text-center text-[var(--tc-text-muted)]"
                >
                  暂无该类型模型
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-xs text-[var(--tc-text-primary)]">
                    {m.model_id}
                  </TableCell>
                  <TableCell className="text-[var(--tc-text-secondary)]">
                    {m.provider_id}
                  </TableCell>
                  <TableCell className="font-medium">{m.model_label}</TableCell>
                  <TableCell>
                    <Badge variant="default">
                      {TYPE_LABEL[m.capability_type] ?? m.capability_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[var(--tc-text-secondary)]">
                    {defaultSummary(m)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.enabled ? "success" : "secondary"}>
                      {m.enabled ? "启用" : "停用"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[var(--tc-text-secondary)]">
                    {m.sort_order}
                  </TableCell>
                  <TableCell className="text-xs text-[var(--tc-text-tertiary)]">
                    {new Date(m.updated_at).toLocaleString("zh-CN")}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
