import type { PrismaClient } from "@prisma/client";
import type {
  ConversationMentionType,
  MentionFailureReason,
} from "@blue-whale/core";
import {
  creativeSkillActivationSchema,
  type CreativeSkillActivation,
} from "@blue-whale/contracts";

import { publicGenerationInput } from "./generation-input.js";
import { classifyMentionAvailability } from "./mention-availability.js";

/** Snapshot 读路径的 job + asset 聚合 db port（Prisma-backed）。
 *  对齐 Java SnapshotService 项目级 GenerationJob 与 Asset 引用读取：
 *  - generation_jobs 按 project_id 过滤、gmt_create desc。
 *  - 按 project_id 一次读取全部 normal assets（包含上传与生成产物，防 N+1）。
 *  对齐部署 schema：conversation_messages / agent_runs / generation_job_outputs /
 *  project_events 表暂无 → 这些切片由 handler 补空数组与 cursor 0。字段 snake_case。 */

export interface SnapshotJobView {
  job_id: string;
  type: string;
  source: string;
  status: string;
  progress: number;
  input: unknown;
  output_asset_ids: string[];
  /** DB 原始 error（结构化 map）；投影成公开信封是 handler 层职责。 */
  stored_error: Record<string, unknown> | null;
}

export interface SnapshotAssetRow {
  id: string;
  type: string;
  url: string;
  /** assets.project_id 在部署 schema 非空（默认 0）；理论可空时按全局 asset 处理。 */
  project_id: string | null;
}

export interface SnapshotJobAggregate {
  generation_jobs: SnapshotJobView[];
  assets: SnapshotAssetRow[];
}

export interface SnapshotConversationState {
  conversation_messages: Array<{
    message_id: string;
    conversation_id: string;
    agent_run_id: string | null;
    role: string;
    content_type: string;
    content: string;
    sequence_no: number;
    created_at: string;
    mentions: SnapshotMentionView[];
  }>;
  /** 已原子接纳的不可变计划卡（T09，IK67H6，契约 §9）：按 ordinal 排序。
   *  临时候选与验证失败的候选永不进入此列表（AC#8）。 */
  plan_messages: SnapshotPlanMessageView[];
  agent_runs: Array<{
    agent_run_id: string;
    conversation_id: string;
    status: string;
    stage: string | null;
    version: number;
    terminal_reason: string | null;
    failure_code: string | null;
    retry_count: number;
    activated_creative_skill_versions: CreativeSkillActivation[];
    reasoning_summary: string | null;
    active_input_request: {
      input_request_id: string;
      request_type: string;
      question: string | null;
      status: string;
      expires_at: string;
    } | null;
  }>;
  high_watermark_cursor: string;
}

export interface SnapshotRepo {
  loadJobsAndAssets(
    projectId: string,
    userId: string,
  ): Promise<SnapshotJobAggregate>;
  loadConversationState(
    projectId: string,
    userId: string,
  ): Promise<SnapshotConversationState>;
}

export interface SnapshotMentionView {
  mention_id: string;
  index: number;
  type: ConversationMentionType;
  display_name: string;
  availability: "available" | "stale" | "unavailable";
  reason: MentionFailureReason | null;
  snapshot?: unknown;
}

/** Snapshot 计划卡投影（T09）：直接透传冻结的不可变字段（JSON 原样），
 *  application_kind / ordinal / 序列标签供前端渲染，content_markdown 为唯一权威正文。 */
export interface SnapshotPlanMessageView {
  message_id: string;
  conversation_id: string;
  agent_run_id: string;
  ordinal: number;
  total_in_batch: number;
  sequence_label: string | null;
  application_kind: string;
  target_scene_card_mention_id: string | null;
  base_scene_card_version: number | null;
  content_markdown: string;
  derived_references: unknown;
  frozen_generation_parameters: unknown;
  capability_snapshot_version: unknown;
  provider_prompt_projection: unknown;
  base_plan_message_id: string | null;
  source_plan_message_id: string | null;
  created_at: string;
}

/** output_asset_ids（Json 数组）→ string[]。容忍 number/string 混合（历史数据）。 */
function parseAssetIdList(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json
    .map((v) =>
      typeof v === "number" || typeof v === "string" ? String(v) : null,
    )
    .filter((v): v is string => v !== null);
}

/** error 列 → 受控 map（仅非数组的 plain object），否则 null。 */
function toStoredError(json: unknown): Record<string, unknown> | null {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    return json as Record<string, unknown>;
  }
  return null;
}

export function createSnapshotRepo(prisma: PrismaClient): SnapshotRepo {
  return {
    async loadJobsAndAssets(projectId, userId) {
      const pid = BigInt(projectId);
      const uid = BigInt(userId);
      const jobs = await prisma.generation_jobs.findMany({
        where: { project_id: pid, is_delete: false },
        orderBy: { gmt_create: "desc" },
      });

      const assetRows = await prisma.assets.findMany({
        where: {
          project_id: pid,
          user_id: uid,
          status: "normal",
          is_delete: false,
        },
      });

      // 对齐 Java：仅保留归属本项目的 asset（防跨项目泄漏）。
      const assets: SnapshotAssetRow[] = [];
      for (const a of assetRows) {
        const rowProjectId =
          a.project_id == null ? null : a.project_id.toString();
        if (rowProjectId !== null && rowProjectId !== projectId) continue;
        assets.push({
          id: a.id.toString(),
          type: a.type,
          url: a.url,
          project_id: rowProjectId,
        });
      }

      const generation_jobs: SnapshotJobView[] = jobs.map((job) => ({
        job_id: job.id.toString(),
        type: job.type,
        source: job.source,
        status: job.status,
        progress: job.progress,
        input: publicGenerationInput(job.input ?? null),
        output_asset_ids: parseAssetIdList(job.output_asset_ids),
        stored_error: toStoredError(job.error),
      }));

      return { generation_jobs, assets };
    },
    async loadConversationState(projectId, userId) {
      const pid = BigInt(projectId);
      const uid = BigInt(userId);
      const [messages, mentionRows, runs, inputRequests, planMessageRows, maxCursorRow] =
        await Promise.all([
          prisma.conversation_messages.findMany({
            where: { project_id: pid, is_delete: 0 },
            orderBy: { sequence_no: "asc" },
          }),
          prisma.conversation_message_mentions.findMany({
            where: { project_id: pid },
            orderBy: [{ message_id: "asc" }, { mention_seq: "asc" }],
            select: {
              id: true,
              message_id: true,
              accepted_user_id: true,
              mention_seq: true,
              mention_type: true,
              target_id: true,
              target_version: true,
              display_name: true,
              snapshot: true,
            },
          }),
          prisma.agent_runs.findMany({
            where: { project_id: pid, is_delete: 0 },
            orderBy: { id: "asc" },
          }),
          prisma.user_input_requests.findMany({
            where: {
              project_id: pid,
              status: "pending",
              expires_at: { gt: new Date() },
              is_delete: 0,
            },
            orderBy: { id: "asc" },
          }),
          prisma.plan_messages.findMany({
            where: { project_id: pid },
            orderBy: [{ agent_run_id: "asc" }, { ordinal: "asc" }],
          }),
          // cursor 改雪花后 project_event_stream.high_watermark 不再维护；
          // 当前水位直接取 project_events 的最大 cursor。
          prisma.project_events.aggregate({
            where: { project_id: pid, is_delete: 0 },
            _max: { cursor: true },
          }),
        ]);
      const assetIds = [
        ...new Set(
          mentionRows
            .filter((mention) => mention.mention_type === "asset")
            .map((mention) => mention.target_id),
        ),
      ];
      const sceneCardIds = [
        ...new Set(
          mentionRows
            .filter((mention) => mention.mention_type === "scene_card")
            .map((mention) => mention.target_id),
        ),
      ];
      const [assets, sceneCards] = await Promise.all([
        assetIds.length === 0
          ? []
          : prisma.assets.findMany({
              where: { id: { in: assetIds } },
              select: {
                id: true,
                user_id: true,
                project_id: true,
                status: true,
                is_delete: true,
              },
            }),
        sceneCardIds.length === 0
          ? []
          : prisma.scene_cards.findMany({
              where: { id: { in: sceneCardIds } },
              select: {
                id: true,
                project_id: true,
                version: true,
                is_delete: true,
              },
            }),
      ]);
      const assetById = new Map(
        assets.map((asset) => [asset.id.toString(), asset]),
      );
      const sceneCardById = new Map(
        sceneCards.map((sceneCard) => [sceneCard.id.toString(), sceneCard]),
      );
      const mentionsByMessage = new Map<string, SnapshotMentionView[]>();
      for (const mention of mentionRows) {
        if (
          mention.mention_type !== "asset" &&
          mention.mention_type !== "scene_card"
        ) {
          continue;
        }
        // 复用唯一可用性谓词（与 agent-run-repo 冻结路径同源，T08）。
        const { availability, reason } = classifyMentionAvailability({
          type: mention.mention_type,
          targetVersion: mention.target_version,
          acceptedUserId: mention.accepted_user_id,
          asset: assetById.get(mention.target_id.toString()),
          sceneCard: sceneCardById.get(mention.target_id.toString()),
          projectId: pid,
          userId: uid,
        });
        const projected: SnapshotMentionView = {
          mention_id: mention.id.toString(),
          index: mention.mention_seq,
          type: mention.mention_type,
          display_name: mention.display_name,
          availability,
          reason,
          ...(availability === "unavailable"
            ? {}
            : { snapshot: mention.snapshot }),
        };
        const messageId = mention.message_id.toString();
        const current = mentionsByMessage.get(messageId) ?? [];
        current.push(projected);
        mentionsByMessage.set(messageId, current);
      }
      const activeByRun = new Map(
        inputRequests
          .filter((request) => request.source_agent_run_id !== null)
          .map((request) => [
            request.source_agent_run_id!.toString(),
            {
              input_request_id: request.id.toString(),
              request_type: request.request_type,
              question: request.question,
              status: request.status,
              expires_at: request.expires_at.toISOString(),
            },
          ]),
      );
      return {
        conversation_messages: messages.map((message) => ({
          message_id: message.id.toString(),
          conversation_id: message.conversation_id.toString(),
          agent_run_id: message.agent_run_id?.toString() ?? null,
          role: message.role,
          content_type: message.content_type,
          content: message.content,
          sequence_no: message.sequence_no,
          created_at: message.gmt_create.toISOString(),
          mentions: mentionsByMessage.get(message.id.toString()) ?? [],
        })),
        plan_messages: planMessageRows.map((plan) => ({
          message_id: plan.message_id.toString(),
          conversation_id: plan.conversation_id.toString(),
          agent_run_id: plan.agent_run_id.toString(),
          ordinal: plan.ordinal,
          total_in_batch: plan.total_in_batch,
          sequence_label: plan.sequence_label,
          application_kind: plan.application_kind,
          target_scene_card_mention_id:
            plan.target_scene_card_mention_id?.toString() ?? null,
          base_scene_card_version: plan.base_scene_card_version,
          content_markdown: plan.content_markdown,
          derived_references: plan.derived_references,
          frozen_generation_parameters: plan.frozen_generation_parameters,
          capability_snapshot_version: plan.capability_snapshot_version,
          provider_prompt_projection: plan.provider_prompt_projection,
          base_plan_message_id: plan.base_plan_message_id?.toString() ?? null,
          source_plan_message_id:
            plan.source_plan_message_id?.toString() ?? null,
          created_at: plan.gmt_create.toISOString(),
        })),
        agent_runs: runs.map((run) => {
          const activations = creativeSkillActivationSchema
            .array()
            .max(1)
            .safeParse(run.activated_creative_skill_versions);
          return {
            agent_run_id: run.id.toString(),
            conversation_id: run.conversation_id.toString(),
            status: run.status,
            stage: run.stage,
            version: run.version,
            terminal_reason:
              run.terminal_reason === "user_requested" ||
              run.terminal_reason === "runtime_error"
                ? run.terminal_reason
                : null,
            failure_code: run.failure_code,
            retry_count: run.retry_count,
            activated_creative_skill_versions: activations.success
              ? activations.data
              : [],
            reasoning_summary:
              typeof run.reasoning_summary === "string" &&
              run.reasoning_summary.length <= 280
                ? run.reasoning_summary
                : null,
            active_input_request: activeByRun.get(run.id.toString()) ?? null,
          };
        }),
        high_watermark_cursor: (maxCursorRow?._max?.cursor ?? 0n).toString(),
      };
    },
  };
}
