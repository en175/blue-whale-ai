import {
  fail,
  ok,
  type PublicGenerationError,
  type ResultEnvelope,
} from "@blue-whale/contracts";
import { projectPublicError } from "@lib/shared/jobs/public-error.js";
import { wireInteger, type WireInteger } from "@lib/shared/wire-integer.js";
import type { ProjectService } from "@lib/shared/project/project.service.js";
import type { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import type { SnapshotService } from "./snapshot.service.js";

const RESOURCE_NOT_FOUND_CODE = 100301;

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
  agent_runs: readonly unknown[];
  plan_messages: readonly unknown[];
  scene_cards: readonly unknown[];
  plan_applications: readonly unknown[];
  scene_card_generation_records: readonly unknown[];
  storyboard_previews: readonly unknown[];
  generation_jobs: SnapshotGenerationJob[];
  assets: Record<string, SnapshotAssetSummary>;
  high_watermark_cursor: WireInteger;
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

  const canvas = await deps.canvas.getByProject(projectId);
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
    };
  }

  return ok({
    project: { ...project, id: wireInteger(project.id) },
    canvas: {
      ...canvas,
      id: canvas.id === null ? null : wireInteger(canvas.id),
      project_id: wireInteger(canvas.project_id),
    },
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
    agent_runs: conversation.agent_runs.map((run) => ({
      ...run,
      agent_run_id: wireInteger(run.agent_run_id),
      conversation_id: wireInteger(run.conversation_id),
      active_input_request:
        run.active_input_request === null
          ? null
          : {
              ...run.active_input_request,
              input_request_id: wireInteger(
                run.active_input_request.input_request_id,
              ),
            },
    })),
    plan_messages: conversation.plan_messages.map((plan) => ({
      ...plan,
      message_id: wireInteger(plan.message_id),
      conversation_id: wireInteger(plan.conversation_id),
      agent_run_id: wireInteger(plan.agent_run_id),
      target_scene_card_mention_id:
        plan.target_scene_card_mention_id === null
          ? null
          : wireInteger(plan.target_scene_card_mention_id),
      base_plan_message_id:
        plan.base_plan_message_id === null
          ? null
          : wireInteger(plan.base_plan_message_id),
      source_plan_message_id:
        plan.source_plan_message_id === null
          ? null
          : wireInteger(plan.source_plan_message_id),
    })),
    scene_cards: conversation.scene_cards.map((card) => ({
      ...card,
      scene_card_id: wireInteger(card.scene_card_id),
    })),
    plan_applications: conversation.plan_applications.map((receipt) => ({
      ...receipt,
      receipt_id: wireInteger(receipt.receipt_id),
      message_id: wireInteger(receipt.message_id),
      scene_card_id:
        receipt.scene_card_id === null
          ? null
          : wireInteger(receipt.scene_card_id),
      first_generation_job_id: wireInteger(receipt.first_generation_job_id),
    })),
    scene_card_generation_records:
      conversation.scene_card_generation_records.map((record) => ({
        ...record,
        record_id: wireInteger(record.record_id),
        scene_card_id: wireInteger(record.scene_card_id),
        first_generation_job_id: wireInteger(record.first_generation_job_id),
        plan_message_id: wireInteger(record.plan_message_id),
      })),
    storyboard_previews: conversation.storyboard_previews.map((preview) => ({
      ...preview,
      preview_id: wireInteger(preview.preview_id),
      scene_card_id: wireInteger(preview.scene_card_id),
      first_generation_job_id: wireInteger(preview.first_generation_job_id),
    })),
    generation_jobs: generation_jobs.map(toWireJob),
    assets: assetMap,
    high_watermark_cursor: wireInteger(conversation.high_watermark_cursor),
  });
}
