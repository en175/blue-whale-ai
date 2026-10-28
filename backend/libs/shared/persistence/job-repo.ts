import { wallClockRfc3339 } from "@lib/core";
import type { PrismaClient } from "@prisma/client";

import {
  VIDEO_SCENE_SPLIT_JOB_TYPE,
  VOCAL_SPLIT_JOB_TYPE,
  VOCAL_SPLIT_SCENE_TRACKS,
} from "@lib/contracts";

import { extractSpecs } from "@lib/shared/billing/billing-specs.js";

import { publicGenerationInput } from "./generation-input.js";
import {
  extraNumber,
  extraString,
  loadJobExtras,
  loadJobExtrasOne,
  type JobExtras,
} from "./generation-jobs-extra-repo.js";





export interface JobListItem {
  job_id: string;
  type: string;
  status: string;
  progress: number;
  input: unknown;
  created_at: string;
  output_assets: JobOutputAsset[];
  canvas_card_state?: string;

  stored_error?: Record<string, unknown> | null;


  video_stage: string;
  source_sample_job_id: string | null;
  final_job_id: string | null;
  finalize_deadline_at: string | null;
  charge_state: string | null;
  actual_credits: number | null;
}

export interface JobOutputAsset {
  id: string;
  url: string;
  type: string;
  width: number | null;
  height: number | null;
}

export interface JobStatusView {
  job_id: string;
  project_id: string;
  type: string;
  status: string;
  progress: number;

  asset: { id: string; url: string; type: string; duration?: number } | null;


  output_assets: JobOutputAsset[];


  result: Record<string, unknown> | null;

  stored_error: Record<string, unknown> | null;

  text_input_signature: string | null;



  tracks: JobVocalSplitTrack[] | null;

  video_stage: string;
  source_sample_job_id: string | null;
  final_job_id: string | null;
  finalize_deadline_at: string | null;
  charge_state: string | null;
  actual_credits: number | null;
}







function videoStageProjection(
  row: { source_sample_job_id: bigint | null },
  extras: JobExtras | undefined,
): {
  video_stage: string;
  source_sample_job_id: string | null;
  final_job_id: string | null;
  finalize_deadline_at: string | null;
  charge_state: string | null;
  actual_credits: number | null;
} {
  const deadlineMs = extraNumber(extras, "finalize_deadline_ms");
  const finalJobId = extraNumber(extras, "final_job_id");
  return {
    video_stage: extraString(extras, "video_stage") ?? "video",
    source_sample_job_id:
      row.source_sample_job_id != null ? row.source_sample_job_id.toString() : null,
    final_job_id: finalJobId != null ? String(finalJobId) : null,

    finalize_deadline_at: deadlineMs != null ? wallClockRfc3339(new Date(deadlineMs)) : null,
    charge_state: extraString(extras, "charge_state"),
    actual_credits: extraNumber(extras, "actual_credits"),
  };
}


export interface JobVocalSplitTrack {
  track_type: string;
  asset_id: string;
  url: string;
  duration: number | null;
}

export interface JobPage {
  records: JobListItem[];
  total: number;
  size: number;
  current: number;
}

export interface JobListFilter {
  type?: string;
  status?: string;
  projectId?: string;
  ids?: string[];
  page: number;
  size: number;
}

export interface UserJobIdFilter {
  userId: string;
  type?: string;
  modelId?: string;
  createdFrom?: Date;
  createdTo?: Date;
  limit: number;
}

export interface UserJobIdResult {
  ids: string[];
  truncated: boolean;
}

export interface JobRepo {
  listByUser(userId: string, filter: JobListFilter): Promise<JobPage>;
  findByIdForUser(jobId: string, userId: string): Promise<JobStatusView | null>;

  listForAdmin(filter: AdminJobListFilter): Promise<AdminJobPage>;

  listUserJobIds(filter: UserJobIdFilter): Promise<UserJobIdResult>;









  loadChargeTaskSummaries(ids: readonly string[]): Promise<Map<string, ChargeTaskSummary>>;
}


export interface ChargeTaskSummary {

  type: string;

  modelId: string | null;

  modelLabel: string | null;

  prompt: string | null;
  specs: Record<string, string> | null;
}













export interface AdminJobListItem {
  job_id: string;
  user_id: string;
  project_id: string;
  type: string;
  status: string;
  progress: number;
  provider: string | null;








  model_id: string | null;






  model_label: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;





  stored_error: Record<string, unknown> | null;
}

export interface AdminJobPage {
  records: AdminJobListItem[];
  total: number;
  size: number;
  current: number;
}


export interface AdminJobListFilter {

  userId?: string;
  projectId?: string;
  type?: string;
  status?: string;
  page: number;
  size: number;
}

type AssetRow = {
  id: bigint;
  url: string;
  type: string;
  width: number | null;
  height: number | null;

  duration_ms: number | null;
};

function parseAssetIds(json: unknown): bigint[] {
  if (!Array.isArray(json)) return [];
  return json
    .map((v) => (typeof v === "number" || typeof v === "string" ? BigInt(v) : null))
    .filter((v): v is bigint => v !== null);
}








function modelIdOf(input: unknown): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = (input as { model_id?: unknown }).model_id;
  return typeof raw === "string" && raw.trim() ? raw : null;
}











function promptOf(input: unknown): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = (input as { prompt?: unknown }).prompt;
  return typeof raw === "string" && raw.trim() ? raw : null;
}

function specsOf(input: unknown, taskType: string): Record<string, string> | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  return extractSpecs(input as Record<string, unknown>, taskType);
}












async function loadModelLabels(
  prisma: PrismaClient,
  modelIds: readonly string[],
): Promise<Map<string, string>> {
  if (modelIds.length === 0) return new Map();
  const caps = await prisma.catalog_models.findMany({
    where: { model_id: { in: [...modelIds] } },
    select: { model_id: true, model_label: true },
    orderBy: { id: "asc" },
  });
  const labelByModel = new Map<string, string>();
  for (const cap of caps) {
    if (!labelByModel.has(cap.model_id)) labelByModel.set(cap.model_id, cap.model_label);
  }
  return labelByModel;
}

export function createJobRepo(prisma: PrismaClient): JobRepo {
  async function loadAssets(ids: bigint[]): Promise<Map<string, AssetRow>> {
    if (ids.length === 0) return new Map();
    const rows: AssetRow[] = await prisma.user_assets.findMany({
      where: { id: { in: ids }, is_delete: false },
    });
    return new Map(rows.map((r) => [r.id.toString(), r]));
  }

  return {
    async listByUser(userId, filter) {
      const where = {
        user_id: BigInt(userId),
        is_delete: false,
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.projectId ? { project_id: BigInt(filter.projectId) } : {}),
        ...(filter.ids ? { id: { in: [...new Set(filter.ids)].map((id) => BigInt(id)) } } : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.generation_jobs.count({ where }),
        prisma.generation_jobs.findMany({
          where,
          orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
          skip: (filter.page - 1) * filter.size,
          take: filter.size,
        }),
      ]);


      const allIds = rows.flatMap((r) => parseAssetIds(r.output_asset_ids));
      const assetMap = await loadAssets([...new Set(allIds)]);

      const extrasByJob = await loadJobExtras(
        prisma,
        rows.map((r) => r.id.toString()),
      );

      const records: JobListItem[] = rows.map((r) => {
        const extras = extrasByJob.get(r.id.toString());
        return {
          job_id: r.id.toString(),
          type: r.type,
          status: r.status,
          progress: r.progress,
          input: publicGenerationInput(r.input ?? null),

          ...(r.type === "audio_mix"
            ? { canvas_card_state: extraString(extras, "canvas_card_state") ?? "pending" }
            : {}),
          created_at: wallClockRfc3339(r.gmt_create),
          output_assets: parseAssetIds(r.output_asset_ids)
            .map((id) => assetMap.get(id.toString()))
            .filter((a): a is AssetRow => a !== undefined)
            .map((a) => ({
              id: a.id.toString(),
              url: a.url,
              type: a.type,
              width: a.width,
              height: a.height,
            })),
          stored_error:
            r.error && typeof r.error === "object" && !Array.isArray(r.error)
              ? (r.error as Record<string, unknown>)
              : null,
          ...videoStageProjection(r, extras),
        };
      });

      return { records, total, size: filter.size, current: filter.page };
    },

    async listForAdmin(filter) {
      const where = {
        is_delete: false,
        ...(filter.userId !== undefined ? { user_id: BigInt(filter.userId) } : {}),
        ...(filter.projectId !== undefined ? { project_id: BigInt(filter.projectId) } : {}),
        ...(filter.type !== undefined ? { type: filter.type } : {}),
        ...(filter.status !== undefined ? { status: filter.status } : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.generation_jobs.count({ where }),
        prisma.generation_jobs.findMany({
          where,


          orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
          skip: (filter.page - 1) * filter.size,
          take: filter.size,
        }),
      ]);


      const modelIds = new Set<string>();
      for (const r of rows) {
        const modelId = modelIdOf(r.input);
        if (modelId !== null) modelIds.add(modelId);
      }
      const labelByModel = await loadModelLabels(prisma, [...modelIds]);

      return {
        records: rows.map((r) => {
          const modelId = modelIdOf(r.input);
          return {
            job_id: r.id.toString(),
            user_id: r.user_id.toString(),
            project_id: r.project_id?.toString() ?? "",
            type: r.type,
            status: r.status,
            progress: r.progress,
            provider: r.provider,
            model_id: modelId,


            model_label: modelId === null ? null : (labelByModel.get(modelId) ?? null),
            retry_count: r.retry_count,
            created_at: wallClockRfc3339(r.gmt_create),
            updated_at: wallClockRfc3339(r.gmt_modified),
            stored_error:
              r.error && typeof r.error === "object" && !Array.isArray(r.error)
                ? (r.error as Record<string, unknown>)
                : null,
          };
        }),
        total,
        size: filter.size,
        current: filter.page,
      };
    },

    async loadChargeTaskSummaries(ids) {
      const unique = [...new Set(ids)];
      if (unique.length === 0) return new Map();

      const rows = await prisma.generation_jobs.findMany({





        where: { id: { in: unique.map((id) => BigInt(id)) } },
        select: { id: true, type: true, input: true },
      });


      const modelIds = new Set<string>();
      const parsed = rows.map((r) => {
        const modelId = modelIdOf(r.input);
        if (modelId !== null) modelIds.add(modelId);
        return {
          id: r.id.toString(),
          type: r.type,
          modelId,
          prompt: promptOf(r.input),
          specs: specsOf(r.input, r.type),
        };
      });
      const labelByModel = await loadModelLabels(prisma, [...modelIds]);


      return new Map(
        parsed.map((p) => [
          p.id,
          {
            type: p.type,
            modelId: p.modelId,
            modelLabel: p.modelId === null ? null : (labelByModel.get(p.modelId) ?? null),
            prompt: p.prompt,
            specs: p.specs,
          },
        ]),
      );
    },

    async listUserJobIds(filter) {
      const where = {
        user_id: BigInt(filter.userId),
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.modelId
          ? { input: { path: "$.model_id", equals: filter.modelId } }
          : {}),
        ...(filter.createdFrom || filter.createdTo
          ? {
              gmt_create: {
                ...(filter.createdFrom ? { gte: filter.createdFrom } : {}),
                ...(filter.createdTo ? { lte: filter.createdTo } : {}),
              },
            }
          : {}),
      };
      const rows = await prisma.generation_jobs.findMany({
        where,
        select: { id: true },
        orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
        take: filter.limit + 1,
      });
      return {
        ids: rows.slice(0, filter.limit).map((r) => r.id.toString()),
        truncated: rows.length > filter.limit,
      };
    },

    async findByIdForUser(jobId, userId) {
      const row = await prisma.generation_jobs.findFirst({
        where: { id: BigInt(jobId), user_id: BigInt(userId), is_delete: false },
      });
      if (!row) return null;

      const extras = await loadJobExtrasOne(prisma, row.id.toString());

      let outputAssets: JobOutputAsset[] = [];
      let audioMixDurationMs: number | null = null;
      if (row.status === "succeeded") {
        const ids = parseAssetIds(row.output_asset_ids);
        const assetMap = await loadAssets(ids);
        if (row.type === "audio_mix" && ids[0] !== undefined) {
          audioMixDurationMs = assetMap.get(ids[0].toString())?.duration_ms ?? null;
        }
        outputAssets = ids
          .map((id) => assetMap.get(id.toString()))
          .filter((a): a is AssetRow => a !== undefined)
          .map((a) => ({
            id: a.id.toString(),
            url: a.url,
            type: a.type,
            width: a.width,
            height: a.height,
          }));
      }
      const firstAsset = outputAssets[0];
      const asset = firstAsset
        ? {
            id: firstAsset.id,
            url: firstAsset.url,
            type: firstAsset.type,
            ...(audioMixDurationMs != null ? { duration: audioMixDurationMs / 1000 } : {}),
          }
        : null;



      let result: JobStatusView["result"] = null;
      if (row.status === "succeeded" && row.type === VIDEO_SCENE_SPLIT_JOB_TYPE) {
        const logRow = await prisma.generation_job_logs.findFirst({
          where: { generation_job_id: row.id, status: "succeeded" },
          orderBy: { occurred_at: "desc" },
          select: { payload: true },
        });
        if (
          logRow?.payload &&
          typeof logRow.payload === "object" &&
          !Array.isArray(logRow.payload)
        ) {
          result = logRow.payload as Record<string, unknown>;
        }
      }





      let tracks: JobStatusView["tracks"] = null;
      if (row.status === "succeeded" && row.type === VOCAL_SPLIT_JOB_TYPE) {
        const ids = parseAssetIds(row.output_asset_ids);
        const scene =
          row.input && typeof row.input === "object" && !Array.isArray(row.input)
            ? (row.input as Record<string, unknown>).scene
            : undefined;
        const trackOrder =
          typeof scene === "string" && scene in VOCAL_SPLIT_SCENE_TRACKS
            ? VOCAL_SPLIT_SCENE_TRACKS[scene as keyof typeof VOCAL_SPLIT_SCENE_TRACKS]
            : undefined;
        if (trackOrder && ids.length > 0) {
          const assetMap = await loadAssets(ids);
          const zipLength = Math.min(ids.length, trackOrder.length);
          tracks = [];
          for (let i = 0; i < zipLength; i++) {
            const id = ids[i];
            const trackType = trackOrder[i];
            if (id === undefined || trackType === undefined) continue;
            const a = assetMap.get(id.toString());
            tracks.push({
              track_type: trackType,
              asset_id: id.toString(),
              url: a?.url ?? "",
              duration: a?.duration_ms != null ? a.duration_ms / 1000 : null,
            });
          }
        }
      }

      return {
        job_id: row.id.toString(),
        project_id: row.project_id?.toString() ?? "",
        type: row.type,
        status: row.status,
        progress: row.progress,
        asset,
        tracks,
        output_assets: outputAssets,
        result,
        stored_error:
          row.error && typeof row.error === "object" && !Array.isArray(row.error)
            ? (row.error as Record<string, unknown>)
            : null,
        text_input_signature:
          row.input && typeof row.input === "object" && !Array.isArray(row.input)
            ? (() => {
                const signature = (row.input as Record<string, unknown>).text_input_signature;
                return typeof signature === "string" ? signature : null;
              })()
            : null,
        ...videoStageProjection(row, extras),
      };
    },
  };
}
