import { Injectable } from "@nestjs/common";
import type { AdminModelCapabilityRow } from "@lib/shared/persistence/index.js";
import { OperationLogService } from "@lib/shared/operation-log/operation-log.service.js";
import { MODEL_CAPABILITY_LABELS } from "./constants.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";

const EDITABLE_FIELDS: {
  key: keyof AdminModelCapabilityRow;
  label: string;
  fmt: (v: unknown) => string;
}[] = [
  { key: "model_label", label: "展示名", fmt: (v) => String(v) },
  { key: "icon", label: "图标", fmt: (v) => (v ? String(v) : "无") },
  { key: "enabled", label: "状态", fmt: (v) => (v ? "启用" : "停用") },
  { key: "sort_order", label: "排序", fmt: (v) => String(v) },
  { key: "supported_sizes", label: "尺寸", fmt: fmtJson },
  { key: "supported_aspect_ratios", label: "比例", fmt: fmtJson },
  { key: "supported_durations", label: "时长", fmt: fmtJson },
  { key: "supported_formats", label: "格式", fmt: fmtJson },
  { key: "default_size", label: "默认尺寸", fmt: (v) => (v ? String(v) : "无") },
  { key: "default_format", label: "默认格式", fmt: (v) => (v ? String(v) : "无") },
  {
    key: "default_aspect_ratio",
    label: "默认比例",
    fmt: (v) => (v ? String(v) : "无"),
  },
  {
    key: "default_duration",
    label: "默认时长",
    fmt: (v) => (v != null ? `${v}s` : "无"),
  },
  { key: "features", label: "特性", fmt: fmtJson },
  { key: "channel", label: "渠道", fmt: (v) => (v ? String(v) : "未设") },
  { key: "request_mapping", label: "请求映射", fmt: fmtJson },
];

function modelTypeLabel(t: string): string {
  return (
    MODEL_CAPABILITY_LABELS[t as keyof typeof MODEL_CAPABILITY_LABELS] ?? t
  );
}

function modelTarget(m: AdminModelCapabilityRow): string {
  return m.model_id;
}

function fmtJson(v: unknown): string {
  if (v == null) return "无";
  if (Array.isArray(v)) {
    const items = v.map((x) => {
      if (typeof x === "object" && x !== null && "id" in x) {
        return String((x as { id: unknown }).id);
      }
      return String(x);
    });
    return items.length ? items.join(",") : "空";
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function describeModelChanges(
  before: AdminModelCapabilityRow,
  after: AdminModelCapabilityRow,
): string {
  const changes: string[] = [];
  for (const f of EDITABLE_FIELDS) {
    const b = before[f.key];
    const a = after[f.key];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      changes.push(`${f.label}：${f.fmt(b)}→${f.fmt(a)}`);
    }
  }
  return changes.length > 0 ? changes.join("；") : "保存模型（无字段变更）";
}

@Injectable()
export class ModelAuditService {
  constructor(private readonly operationLog: OperationLogService) {}

  private async writeLog(
    entry: { action: string; target: string; detail: string },
    operator: string,
  ): Promise<void> {
    try {
      await this.operationLog.create({
        category: "model.capability",
        operator,
        ...entry,
      });
    } catch (e) {
      logger.error(
        `[model-capability] 审计写入失败（不影响模型主流程）: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async logCreate(model: AdminModelCapabilityRow, operator: string) {
    await this.writeLog(
      {
        action: "model.create",
        target: modelTarget(model),
        detail: `新建模型：${modelTypeLabel(model.capability_type)}「${model.model_label}」（${model.provider_id}/${model.model_id}）`,
      },
      operator,
    );
  }

  async logUpdate(
    before: AdminModelCapabilityRow,
    after: AdminModelCapabilityRow,
    operator: string,
  ) {
    await this.writeLog(
      {
        action: "model.update",
        target: modelTarget(after),
        detail: describeModelChanges(before, after),
      },
      operator,
    );
  }

  async logToggle(after: AdminModelCapabilityRow, operator: string) {
    await this.writeLog(
      {
        action: "model.toggle",
        target: modelTarget(after),
        detail: `启停模型：${modelTypeLabel(after.capability_type)}「${after.model_label}」（${after.provider_id}/${after.model_id}）→ ${after.enabled ? "启用" : "停用"}`,
      },
      operator,
    );
  }

  async logSetDefault(after: AdminModelCapabilityRow, operator: string) {
    await this.writeLog(
      {
        action: "model.set-default",
        target: modelTarget(after),
        detail: `设为默认模型：${modelTypeLabel(after.capability_type)}「${after.model_label}」（${after.provider_id}/${after.model_id}）；同类其它模型的默认标记已清除`,
      },
      operator,
    );
  }

  async logReorder(
    changes: { id: string; model_id: string; sortOrder: number }[],
    operator: string,
  ) {
    const detail =
      changes.length > 0
        ? changes.map((c) => `${c.model_id}→${c.sortOrder}`).join("，")
        : "排序调整（无变更）";
    await this.writeLog(
      {
        action: "model.reorder",
        target: changes[0]?.model_id ?? "",
        detail,
      },
      operator,
    );
  }

  async logDelete(model: AdminModelCapabilityRow, operator: string) {
    await this.writeLog(
      {
        action: "model.delete",
        target: modelTarget(model),
        detail: `删除模型：${modelTypeLabel(model.capability_type)}「${model.model_label}」（${model.provider_id}/${model.model_id}），排序 ${model.sort_order}`,
      },
      operator,
    );
  }
}
