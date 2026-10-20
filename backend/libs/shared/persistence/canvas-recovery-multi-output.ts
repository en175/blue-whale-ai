import {
  PRIMARY_OUTPUT_KEY,
  TARGET_OUTPUT_KEY,
  VIDEO_SCENE_SPLIT_JOB_TYPE,
  VOCAL_SPLIT_JOB_TYPE,
  VOCAL_SPLIT_SCENE_TRACKS,
  videoSceneSplitResultSchema,
} from "@lib/contracts";

import { resolveLogicalSlots, type OutputSlotStatus } from "./generation-output-slot-repo.js";


export function slotOutputKey(slotId: string | bigint): string {
  return `slot:${slotId}`;
}

export function segmentOutputKey(segmentIndex: number): string {
  return `segment:${segmentIndex}`;
}

export function trackOutputKey(trackType: string): string {
  return `track:${trackType}`;
}


export const GENERATION_RESULT_NODE_PREFIX = "generation-result:";
export const OUTPUT_SLOT_NODE_PREFIX = "generation-output:";

export function multiResultNodeId(submissionId: string, outputKey: string): string {
  return `${GENERATION_RESULT_NODE_PREFIX}${submissionId}:${outputKey}`;
}

export function outputSlotNodeId(slotId: string | bigint): string {
  return `${OUTPUT_SLOT_NODE_PREFIX}${slotId}`;
}

export function outputNodeIdForKey(
  outputKey: string,
  ctx: { submissionId: string; targetNodeId: string },
): string {
  if (outputKey === TARGET_OUTPUT_KEY || outputKey === PRIMARY_OUTPUT_KEY) return ctx.targetNodeId;
  if (outputKey.startsWith("slot:")) return outputSlotNodeId(outputKey.slice("slot:".length));
  return multiResultNodeId(ctx.submissionId, outputKey);
}

export function isMultiResultOutputKey(outputKey: string): boolean {
  return outputKey !== TARGET_OUTPUT_KEY && outputKey !== PRIMARY_OUTPUT_KEY;
}


export interface VirtualOutputItem {
  outputKey: string;
  nodeId: string;
  assetId: string | null;
  slotId: string | null;
}

export type VirtualOutputProjection =
  | { kind: "ok"; items: VirtualOutputItem[] }
  | { kind: "invalid" };

export interface ProjectableJob {
  id: bigint;
  type: string;
  status: string;
  output_asset_ids: unknown;
  input: unknown;
}

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

export function trustedAssetIdOf(
  projection: Extract<VirtualOutputProjection, { kind: "ok" }>,
  job: ProjectableJob | null,
  outputKey: string,
): string | null {
  if (outputKey === PRIMARY_OUTPUT_KEY) {
    const assets = parseAssetIds(job?.output_asset_ids);
    return assets !== null && assets.length === 1 ? assets[0]! : null;
  }
  return projection.items.find(item => item.outputKey === outputKey)?.assetId ?? null;
}

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
  if (!logRow?.payload || typeof logRow.payload !== "object" || Array.isArray(logRow.payload)) {
    return { kind: "invalid" };
  }
  const payload = logRow.payload as Record<string, unknown>;
  const parsed = videoSceneSplitResultSchema.safeParse({
    duration: payload.duration,
    segments: payload.segments,
  });
  if (!parsed.success) return { kind: "invalid" };
  const seen = new Set<number>();
  const items: VirtualOutputItem[] = [];
  for (const segment of parsed.data.segments) {
    if (seen.has(segment.segment_index)) return { kind: "invalid" };
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

function projectVocalSplit(job: ProjectableJob, submissionId: string): VirtualOutputProjection {
  const scene =
    job.input && typeof job.input === "object" && !Array.isArray(job.input)
      ? (job.input as Record<string, unknown>).scene
      : undefined;
  if (typeof scene !== "string" || !(scene in VOCAL_SPLIT_SCENE_TRACKS)) {
    return { kind: "invalid" };
  }
  const trackOrder = VOCAL_SPLIT_SCENE_TRACKS[scene as keyof typeof VOCAL_SPLIT_SCENE_TRACKS];
  const assetIds = parseAssetIds(job.output_asset_ids);
  if (assetIds === null || assetIds.length !== trackOrder.length) {
    return { kind: "invalid" };
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

function expectedOutputCountOf(input: unknown): number {
  const count = input && typeof input === "object" && !Array.isArray(input)
    ? Number((input as Record<string, unknown>).expected_output_count)
    : Number.NaN;
  return Number.isInteger(count) && count > 0 ? count : 1;
}

async function projectGenerationSlots(
  tx: SlotTx,
  job: ProjectableJob,
  targetNodeId: string,
): Promise<VirtualOutputProjection> {
  if (expectedOutputCountOf(job.input) <= 1) {
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
    return { kind: "invalid" };
  }
  const collected = [...slotRows];
  const known = new Set(collected.map(slot => slot.id));
  let frontier = slotRows;
  while (frontier.length > 0) {
    const retryIds = frontier
      .map(slot => slot.retry_of_slot_id)
      .filter((id): id is bigint => id !== null);
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
    if (fresh.length === 0) break;
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
