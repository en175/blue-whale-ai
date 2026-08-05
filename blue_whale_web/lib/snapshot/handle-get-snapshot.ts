import { fail, ok, type ResultEnvelope } from "@blue-whale/contracts";
import type {
  CanvasRepo,
  CanvasView,
  ProjectRepo,
  ProjectView,
  SnapshotAssetRow,
  SnapshotRepo,
} from "@blue-whale/persistence";
import { projectPublicError, type PublicJobError } from "../jobs/public-error";
import { wireInteger, type WireInteger } from "../wire-integer";

/** Java SystemCode.RESOURCE_NOT_FOUND_CODE：归属/资源不存在一律不泄漏。 */
const RESOURCE_NOT_FOUND_CODE = 100301;

/** Snapshot 信封里的 generation_job 摘要（对齐 Java GenerationJobDto，snake_case wire）。 */
export interface SnapshotGenerationJob {
  job_id: string;
  type: string;
  source: string;
  status: string;
  progress: number;
  input: unknown;
  output_asset_ids: string[];
  error: PublicJobError | null;
}

/** assets map 项（对齐 Java AssetDto：{asset_id, access_url, type}）。 */
export interface SnapshotAssetSummary {
  asset_id: string;
  access_url: string;
  type: string;
}

/** GET /api/projects/{id}/snapshot 返回的恢复快照。 */
export interface SnapshotData {
  project: Omit<ProjectView, "id"> & { id: WireInteger };
  canvas: Omit<CanvasView, "id" | "project_id"> & {
    id: WireInteger | null;
    project_id: WireInteger;
  };
  conversation_messages: readonly unknown[];
  agent_runs: readonly unknown[];
  /** 已原子接纳的不可变计划卡（T09，IK67H6，契约 §9）。 */
  plan_messages: readonly unknown[];
  /** 已创建的视频场景卡（IK67H9，T11）。 */
  scene_cards: readonly unknown[];
  /** 成功应用 PlanMessage 的不可变回执（IK67H9，T11）。 */
  plan_applications: readonly unknown[];
  generation_jobs: SnapshotGenerationJob[];
  assets: Record<string, SnapshotAssetSummary>;
  high_watermark_cursor: WireInteger;
}

export interface SnapshotDeps {
  projects: Pick<ProjectRepo, "findOwnedById">;
  canvas: Pick<CanvasRepo, "getByProject">;
  snapshot: SnapshotRepo;
}

/** Snapshot 直接暴露 Asset 持久化 URL，Canvas/下载方无需再换取产品代理地址。 */
export function assetAccessUrl(
  _projectId: string,
  asset: {
    id: string;
    type: string;
    url: string;
    project_id: string | null;
  },
): string {
  return asset.url;
}

function toWireJob(job: {
  job_id: string;
  type: string;
  source: string;
  status: string;
  progress: number;
  input: unknown;
  output_asset_ids: string[];
  stored_error: Record<string, unknown> | null;
}): SnapshotGenerationJob {
  return {
    job_id: job.job_id,
    type: job.type,
    source: job.source,
    status: job.status,
    progress: job.progress,
    input: job.input,
    output_asset_ids: job.output_asset_ids,
    error:
      job.status === "failed"
        ? projectPublicError(job.stored_error, job.type)
        : null,
  };
}

/** GET /api/projects/{projectId}/snapshot：先验归属（100301 不泄漏）→ 聚合 project/canvas/jobs/assets。 */
export async function handleGetSnapshot(
  userId: string,
  projectId: string,
  deps: SnapshotDeps,
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
      access_url: assetAccessUrl(projectId, asset),
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
    generation_jobs: generation_jobs.map(toWireJob),
    assets: assetMap,
    high_watermark_cursor: wireInteger(conversation.high_watermark_cursor),
  });
}

// 仅类型再导出，方便 deps 装配处按需引用
export type { SnapshotAssetRow };
