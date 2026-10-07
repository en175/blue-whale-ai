/* ============================================
 * IKJJQY（IKIXK9-SPEC-20261002 B.4）：多结果家族（生成输出槽 / 场景切分 / 人声分离）
 * 的输出身份构造与可信终态投影。
 *
 * 输出键与 node_id 规范（B.4 output_key 表）在此单源，保存与恢复查询两侧共用：
 *   · slot:<slot_id>        → generation-output:<slot_id>（沿用既有槽位卡身份，不伪造）
 *   · segment:<index>       → generation-result:<submission_id>:segment:<index>
 *   · track:<track_type>    → generation-result:<submission_id>:track:<track_type>
 *   · primary / $target     → target_node_id（QU 一对一，明确转换标记后复用）
 *
 * 投影只读可信终态（槽行 / 终态日志 payload / output_asset_ids + 冻结 scene），
 * 不写库；重复键、缺产物或归属无法证明时返回 invalid（调用方按 recovery_projection_invalid
 * 处置：查询侧保留占位不投影输出，保存侧 replaceTarget 拒绝），不自动重发任务。
 * ============================================ */
import {
  PRIMARY_OUTPUT_KEY,
  TARGET_OUTPUT_KEY,
  VIDEO_SCENE_SPLIT_JOB_TYPE,
  VOCAL_SPLIT_JOB_TYPE,
  VOCAL_SPLIT_SCENE_TRACKS,
  videoSceneSplitResultSchema,
} from "@lib/contracts";

import { resolveLogicalSlots, type OutputSlotStatus } from "./generation-output-slot-repo.js";

// ── 输出键构造 ────────────────────────────────────────────────────────────────

export function slotOutputKey(slotId: string | bigint): string {
  return `slot:${slotId}`;
}

export function segmentOutputKey(segmentIndex: number): string {
  return `segment:${segmentIndex}`;
}

export function trackOutputKey(trackType: string): string {
  return `track:${trackType}`;
}

// ── 节点身份（规范单源：保存 marker 校验 / owner 行 / 恢复页 items 共用） ──────────

export const GENERATION_RESULT_NODE_PREFIX = "generation-result:";
export const OUTPUT_SLOT_NODE_PREFIX = "generation-output:";

/** 多结果输出的规范节点身份：generation-result:<submission_id>:<output_key>。 */
export function multiResultNodeId(submissionId: string, outputKey: string): string {
  return `${GENERATION_RESULT_NODE_PREFIX}${submissionId}:${outputKey}`;
}

/** 输出槽卡身份：沿用画布既有的 generation-output:<slot_id> 形态。 */
export function outputSlotNodeId(slotId: string | bigint): string {
  return `${OUTPUT_SLOT_NODE_PREFIX}${slotId}`;
}

/** 输出项规范 node_id：一对一（$target/primary）复用目标节点，多结果走独立身份。 */
export function outputNodeIdForKey(
  outputKey: string,
  ctx: { submissionId: string; targetNodeId: string },
): string {
  if (outputKey === TARGET_OUTPUT_KEY || outputKey === PRIMARY_OUTPUT_KEY) return ctx.targetNodeId;
  if (outputKey.startsWith("slot:")) return outputSlotNodeId(outputKey.slice("slot:".length));
  return multiResultNodeId(ctx.submissionId, outputKey);
}

/** 多结果输出键（slot:/segment:/track:）——与一对一（$target/primary）区分：
 *  保存侧 remove 的 replaceTarget 配套要求只约束一对一 primary（B.6）。 */
export function isMultiResultOutputKey(outputKey: string): boolean {
  return outputKey !== TARGET_OUTPUT_KEY && outputKey !== PRIMARY_OUTPUT_KEY;
}

// ── 可信终态投影（B.4/B.5：pending/0 虚拟项，不写库；歧义 → invalid） ─────────────

export interface VirtualOutputItem {
  outputKey: string;
  nodeId: string;
  assetId: string | null;
  slotId: string | null;
}

export type VirtualOutputProjection =
  | { kind: "ok"; items: VirtualOutputItem[] }
  | { kind: "invalid" };

/** 投影输入的 job 最小形状（恢复页/保存事务内已读的行）。 */
export interface ProjectableJob {
  id: bigint;
  type: string;
  status: string;
  output_asset_ids: unknown;
  input: unknown;
}

/** 解析任务产物清单列（output_asset_ids）：正整数字符串/安全整数数组，形态不可信返回 null。
 *  IKJLTS：导出供保存侧核对 primary 可信产物资产。 */
export function parseAssetIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item === "number" && Number.isSafeInteger(item) && item > 0) ids.push(String(item));
    else if (typeof item === "string" && /^[1-9][0-9]*$/.test(item)) ids.push(item);
    else return null;
  }
  return ids;
}

/** 场景切分：终态日志 payload（契约 videoSceneSplitResultSchema）→ segment 项。 */
async function projectSceneSplit(
  tx: SceneSplitTx,
  job: ProjectableJob,
  submissionId: string,
): Promise<VirtualOutputProjection> {
  const logRow = await tx.generation_job_logs.findFirst({
    where: { generation_job_id: job.id, status: "succeeded" },
    orderBy: { occurred_at: "desc" },
    select: { payload: true },
  });
  if (!logRow?.payload) return { kind: "invalid" }; // 成功却无可信结果：缺产物
  const parsed = videoSceneSplitResultSchema.safeParse(logRow.payload);
  if (!parsed.success) return { kind: "invalid" };
  const seen = new Set<number>();
  const items: VirtualOutputItem[] = [];
  for (const segment of parsed.data.segments) {
    if (seen.has(segment.segment_index)) return { kind: "invalid" }; // 重复键
    seen.add(segment.segment_index);
    const outputKey = segmentOutputKey(segment.segment_index);
    items.push({
      outputKey,
      nodeId: multiResultNodeId(submissionId, outputKey),
      assetId: segment.segment_asset_id,
      slotId: null,
    });
  }
  return { kind: "ok", items };
}

/** 人声分离：冻结 scene 的契约轨序 + output_asset_ids 严格 zip（长度不齐 = 缺产物）。 */
function projectVocalSplit(job: ProjectableJob, submissionId: string): VirtualOutputProjection {
  const scene =
    job.input && typeof job.input === "object" && !Array.isArray(job.input)
      ? (job.input as Record<string, unknown>).scene
      : undefined;
  if (typeof scene !== "string" || !(scene in VOCAL_SPLIT_SCENE_TRACKS)) {
    return { kind: "invalid" }; // 无法证明轨归属
  }
  const trackOrder = VOCAL_SPLIT_SCENE_TRACKS[scene as keyof typeof VOCAL_SPLIT_SCENE_TRACKS];
  const assetIds = parseAssetIds(job.output_asset_ids);
  if (assetIds === null || assetIds.length !== trackOrder.length) {
    return { kind: "invalid" }; // 缺产物 / 形态不可信
  }
  const items: VirtualOutputItem[] = trackOrder.map((trackType, index) => {
    const outputKey = trackOutputKey(trackType);
    return {
      outputKey,
      nodeId: multiResultNodeId(submissionId, outputKey),
      assetId: assetIds[index]!,
      slotId: null,
    };
  });
  return { kind: "ok", items };
}

/** 生成家族投影分派：expected_output_count ≤1（含读不出的老任务）为一对一 primary
 *  （前端单输出结果回填目标卡，槽行不改变身份——不为单输出伪造 slot 键）；>1 走多输出槽
 *  （前端 generation-output:<slot_id> 卡）。权威口径同 generation-command-repo：
 *  主表 expected_output_count 列已删，input 快照必写，读不出按 1 兜底。 */
function expectedOutputCountOf(input: unknown): number {
  const count = input && typeof input === "object" && !Array.isArray(input)
    ? Number((input as Record<string, unknown>).expected_output_count)
    : Number.NaN;
  return Number.isInteger(count) && count > 0 ? count : 1;
}

/** 生成家族：多输出（count>1）走槽（逻辑槽折叠，成功槽永久占据）。
 *  重试只补 failed/missing 槽——成功槽仍挂在被重试 job 名下，故沿 retry_of_slot_id
 *  上溯祖辈槽一并折叠（槽位身份稳定，不因重试换卡）。 */
async function projectGenerationSlots(
  tx: SlotTx,
  job: ProjectableJob,
  targetNodeId: string,
): Promise<VirtualOutputProjection> {
  if (expectedOutputCountOf(job.input) <= 1) {
    // QU 单结果兜底：任务行有成功输出即 primary（不伪造槽位）。
    const assets = parseAssetIds(job.output_asset_ids);
    return {
      kind: "ok",
      items: assets !== null && assets.length > 0
        ? [{ outputKey: PRIMARY_OUTPUT_KEY, nodeId: targetNodeId, assetId: null, slotId: null }]
        : [],
    };
  }
  const slotRows = await tx.generation_output_slots.findMany({
    where: { generation_job_id: job.id },
    orderBy: { id: "asc" },
  });
  if (slotRows.length === 0) {
    // 声明多输出却无槽行：归属无法证明（槽表是输出数权威，IKJCOE）。
    return { kind: "invalid" };
  }
  // 上溯重试链：祖辈槽及其所属 job 的全部兄弟槽并入折叠集（成功槽不重跑、留在原 job 名下）。
  const collected = [...slotRows];
  const known = new Set(collected.map(slot => slot.id));
  let frontier = slotRows;
  while (frontier.length > 0) {
    const retryIds = frontier
      .map(slot => slot.retry_of_slot_id)
      .filter((id): id is bigint => id !== null);
    // frontier 所属 job 的全部槽无条件并入（known 行去重；跨轮重复查询一次，链深实际 1-2）。
    const siblingJobIds = [...new Set(frontier.map(slot => slot.generation_job_id))];
    const fetched: typeof collected = [];
    if (retryIds.length > 0) {
      fetched.push(...await tx.generation_output_slots.findMany({
        where: { id: { in: retryIds } },
        orderBy: { id: "asc" },
      }));
    }
    if (siblingJobIds.length > 0) {
      fetched.push(...await tx.generation_output_slots.findMany({
        where: { generation_job_id: { in: siblingJobIds } },
        orderBy: { id: "asc" },
      }));
    }
    const fresh: typeof collected = [];
    for (const row of fetched) {
      if (known.has(row.id)) continue;
      known.add(row.id);
      collected.push(row);
      fresh.push(row);
    }
    if (fresh.length === 0) break; // 防御环链：无新行即收敛
    frontier = fresh;
  }
  const items: VirtualOutputItem[] = [];
  const logicalSlots = resolveLogicalSlots(
    collected.map(slot => ({ ...slot, status: slot.status as OutputSlotStatus })),
  );
  for (const slot of logicalSlots) {
    if (slot.status !== "succeeded" || slot.asset_id === null) continue;
    items.push({
      outputKey: slotOutputKey(slot.id),
      nodeId: outputSlotNodeId(slot.id),
      assetId: slot.asset_id.toString(),
      slotId: slot.id.toString(),
    });
  }
  return { kind: "ok", items };
}

interface SceneSplitTx {
  generation_job_logs: {
    findFirst(args: unknown): Promise<{ payload: unknown } | null>;
  };
}
/** 槽行最小形状（投影折叠输入；DB 行 status 为 string，折叠前收窄为契约四态）。 */
interface ProjectableSlotRow {
  id: bigint;
  generation_job_id: bigint;
  slot_index: number;
  status: string;
  asset_id: bigint | null;
  retry_of_slot_id: bigint | null;
}

interface SlotTx {
  generation_output_slots: {
    findMany(args: unknown): Promise<ProjectableSlotRow[]>;
  };
}

/** 从任务可信终态计算虚拟输出项（B.4：序号/轨型/槽位身份来自终态数据，
 *  不按数组偶然顺序重新编号）。job 为空或未成功时无输出投影（占位保留，非歧义）。 */
export async function projectVirtualOutputs(
  tx: SceneSplitTx & SlotTx,
  args: { submissionId: string; targetNodeId: string; job: ProjectableJob | null },
): Promise<VirtualOutputProjection> {
  const { job } = args;
  if (!job || job.status !== "succeeded") return { kind: "ok", items: [] };
  if (job.type === VIDEO_SCENE_SPLIT_JOB_TYPE) {
    return projectSceneSplit(tx, job, args.submissionId);
  }
  if (job.type === VOCAL_SPLIT_JOB_TYPE) {
    return projectVocalSplit(job, args.submissionId);
  }
  return projectGenerationSlots(tx, job, args.targetNodeId);
}
