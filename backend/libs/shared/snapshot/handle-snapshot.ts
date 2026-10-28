import {
  RESOURCE_NOT_FOUND_CODE,
  fail,
  ok,
  type LegacyMigrationReport,
  type PublicGenerationError,
  type ResultEnvelope,
} from "@lib/contracts";
import { projectPublicError } from "@lib/shared/jobs/generation-job-error-projection.js";
import { wireInteger, type WireInteger } from "@lib/shared/wire-integer.js";
import type { ProjectService } from "@lib/shared/project/project.service.js";
import type { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import type { SnapshotService } from "./snapshot.service.js";

export interface SnapshotGenerationJob {
  job_id: string;
  retry_of_job_id: string | null;
  type: string;
  source: string;
  status: string;
  progress: number;
  input: unknown;
  output_asset_ids: string[];
  output_slots: Array<{
    slot_id: string;
    slot_index: number;
    status: string;
    asset_id: string | null;
    retry_of_slot_id: string | null;
    initial_placement_status: "pending" | "placed";
  }>;
  error: PublicGenerationError | null;
}

export interface SnapshotAssetSummary {
  asset_id: string;
  access_url: string;
  type: string;
  material_id: string | null;
  material_status: string | null;
  material_status_checked_at: string | null;
  md5: string | null;
}

export interface SnapshotData {
  project: { id: WireInteger; name: string; thumb: string | null; created_at: string };
  canvas: {
    id: WireInteger | null;
    project_id: WireInteger;
    viewport: string | null;
    nodes: string | null;
    version: number | null;
  };
  conversation_messages: readonly unknown[];
  scene_cards: readonly unknown[];
  scene_card_generation_records: readonly unknown[];
  storyboard_previews: readonly unknown[];
  generation_jobs: SnapshotGenerationJob[];
  assets: Record<string, SnapshotAssetSummary>;
  legacy_migration?: LegacyMigrationReport;
}

function toWireJob(job: {
  job_id: string;
  retry_of_job_id: string | null;
  type: string;
  source: string;
  status: string;
  progress: number;
  input: unknown;
  output_asset_ids: string[];
  output_slots: SnapshotGenerationJob["output_slots"];
  stored_error: Record<string, unknown> | null;
}): SnapshotGenerationJob {
  return {
    job_id: job.job_id,
    retry_of_job_id: job.retry_of_job_id,
    type: job.type,
    source: job.source,
    status: job.status,
    progress: job.progress,
    input: job.input,
    output_asset_ids: job.output_asset_ids,
    output_slots: job.output_slots,
    error:
      job.status === "failed"
        ? projectPublicError(job.stored_error, job.type)
        : null,
  };
}

export async function handleGetSnapshot(
  userId: string,
  projectId: string,
  deps: {
    projects: ProjectService;
    canvas: CanvasService;
    snapshot: SnapshotService;
  },
): Promise<ResultEnvelope<SnapshotData>> {
  const project = await deps.projects.findOwnedById(projectId, userId);
  if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

  const { canvas, report } = await deps.canvas.migrateLegacyCards(projectId);
  const [{ generation_jobs, assets }, conversation] = await Promise.all([
    deps.snapshot.loadJobsAndAssets(projectId, userId),
    deps.snapshot.loadConversationState(projectId, userId),
  ]);

  const assetMap: Record<string, SnapshotAssetSummary> = {};
  for (const asset of assets) {
    assetMap[asset.id] = {
      asset_id: asset.id,
      access_url: asset.url,
      type: asset.type,
      material_id: asset.material_id ?? null,
      material_status: asset.material_status ?? null,
      material_status_checked_at: asset.material_status_checked_at ?? null,
      md5: asset.md5 ?? null,
    };
  }

  return ok({
    project: { ...project, id: wireInteger(project.id) },
    canvas: {
      ...canvas,
      id: canvas.id === null ? null : wireInteger(canvas.id),
      project_id: wireInteger(canvas.project_id),
    },
    ...(report.migrated.length > 0 || report.failed.length > 0
      ? { legacy_migration: report }
      : {}),
    conversation_messages: conversation.conversation_messages.map(
      (message) => ({
        ...message,
        message_id: wireInteger(message.message_id),
        conversation_id: wireInteger(message.conversation_id),
        agent_run_id:
          message.agent_run_id === null
            ? null
            : wireInteger(message.agent_run_id),
        mentions: message.mentions.map((mention) => ({
          ...mention,
          mention_id: wireInteger(mention.mention_id),
        })),
      }),
    ),
    scene_cards: conversation.scene_cards.map((card) => ({
      ...card,
      scene_card_id: wireInteger(card.scene_card_id),
    })),
    scene_card_generation_records:
      conversation.scene_card_generation_records.map((record) => ({
        ...record,
        record_id: wireInteger(record.record_id),
        scene_card_id: wireInteger(record.scene_card_id),
        first_generation_job_id: wireInteger(record.first_generation_job_id),
      })),
    storyboard_previews: conversation.storyboard_previews.map((preview) => ({
      ...preview,
      preview_id: wireInteger(preview.preview_id),
      scene_card_id: wireInteger(preview.scene_card_id),
      first_generation_job_id: wireInteger(preview.first_generation_job_id),
    })),
    generation_jobs: generation_jobs.map(toWireJob),
    assets: assetMap,
  });
}
