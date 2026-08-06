import type { AdminModelCapabilityRow } from "@blue-whale/persistence";

import { createOperationLogDeps } from "@/lib/operation-log/deps";

import { MODEL_CAPABILITY_LABELS } from "./constants";

/**
 * 模型目录操作审计（服务端写入）。
 *
 * 落点原则同 topup-tiers：POST/PUT 路由是变更的事实源（before/after 快照服务端
 * 都持有），故审计在服务端写，不由浏览器端补记。operator 取 withAdminUser 解析的
 * 管理员用户名（new-api 账户）。
 *
 * 审计契约（IK6T46 Implementation Decisions）：category=`model.capability`，
 * action=`model.create` / `model.update`，target=model_id，operator=当前管理员；
 * 变更明细放 detail（自由文本）。沿用 topup-tiers 的审计与响应模式。
 *
 * best-effort：审计失败只记录、不阻断模型主流程（与档位同策略）。
 */

/** 模型可编辑字段清单：审计 diff 用它逐项比对（before→after）。 */
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
  {
    key: "default_size",
    label: "默认尺寸",
    fmt: (v) => (v ? String(v) : "无"),
  },
  {
    key: "default_format",
    label: "默认格式",
    fmt: (v) => (v ? String(v) : "无"),
  },
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
];

function modelTypeLabel(t: string): string {
  return (
    MODEL_CAPABILITY_LABELS[t as keyof typeof MODEL_CAPABILITY_LABELS] ?? t
  );
}

/** 模型定位标识（审计 target）：model_id（契约 IK6T46）。provider 放 detail。 */
function modelTarget(m: AdminModelCapabilityRow): string {
  return m.model_id;
}

/** 能力 JSON 列审计展示：数组取各元素 id（尺寸/时长档名），对象序列化，空 → "空"。 */
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

/** 编辑模型：对比改前后视图，列出具体变更字段（旧→新）。 */
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

async function writeLog(
  entry: { action: string; target: string; detail: string },
  operator: string,
): Promise<void> {
  try {
    const { db } = createOperationLogDeps();
    await db.create({ category: "model.capability", operator, ...entry });
  } catch (e) {
    console.error("[model-capability] 审计写入失败（不影响模型主流程）", e);
  }
}

export async function logModelCreate(
  model: AdminModelCapabilityRow,
  operator: string,
): Promise<void> {
  await writeLog(
    {
      action: "model.create",
      target: modelTarget(model),
      detail: `新建模型：${modelTypeLabel(model.capability_type)}「${model.model_label}」（${model.provider_id}/${model.model_id}）`,
    },
    operator,
  );
}

export async function logModelUpdate(
  before: AdminModelCapabilityRow,
  after: AdminModelCapabilityRow,
  operator: string,
): Promise<void> {
  await writeLog(
    {
      action: "model.update",
      target: modelTarget(after),
      detail: describeModelChanges(before, after),
    },
    operator,
  );
}
