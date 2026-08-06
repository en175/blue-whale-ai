import type { PrismaClient } from "@prisma/client";
import {
  classifyPlanApplicationAvailability,
  type ConversationMentionType,
  type MentionFailureReason,
} from "@blue-whale/core";
import {
  creativeSkillActivationSchema,
  type CapabilitySnapshotVersion,
  type CreativeSkillActivation,
  type DerivedReference,
} from "@blue-whale/contracts";

import { publicGenerationInput } from "./generation-input.js";
import { classifyMentionAvailability } from "./mention-availability.js";
import { loadPlanApplicationFacts } from "./plan-application-facts.js";
import {
  resolveLogicalSlots,
  type OutputSlotStatus,
} from "./generation-output-slot-repo.js";

/** Snapshot 读路径的 job + asset 聚合 db port（Prisma-backed）。
 *  对齐 Java SnapshotService 项目级 GenerationJob 与 Asset 引用读取：
 *  - generation_jobs 按 project_id 过滤、gmt_create desc。
 *  - 按 project_id 一次读取全部 normal assets（包含上传与生成产物，防 N+1）。
 *  对齐部署 schema：conversation_messages / agent_runs / generation_job_outputs /
 *  project_events 表暂无 → 这些切片由 handler 补空数组与 cursor 0。字段 snake_case。 */

export interface SnapshotOutputSlotView {
  slot_id: string;
  slot_index: number;
  status: OutputSlotStatus;
  asset_id: string | null;
  retry_of_slot_id: string | null;
  initial_placement_status: "pending" | "placed";
}

export interface SnapshotJobView {
  job_id: string;
  retry_of_job_id: string | null;
  type: string;
  source: string;
  status: string;
  progress: number;
  input: unknown;
  output_asset_ids: string[];
  /** IK67HE/T14：该 job 的固定输出槽（按 slot_index 升序稳定排序）。 */
  output_slots: SnapshotOutputSlotView[];
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
  /** 已创建的视频场景卡（IK67H9，T11）：plan_message 应用产物，按 id 升序。 */
  scene_cards: SnapshotSceneCardView[];
  /** 成功应用 PlanMessage 的不可变回执（IK67H9，T11）：按 applied_at 升序。 */
  plan_applications: SnapshotPlanApplicationReceiptView[];
  /** SceneCard 生成记录（IK67HB，T13）：generation origins/summaries 恢复权威子集，按 id 升序。 */
  scene_card_generation_records: SnapshotSceneCardGenerationRecordView[];
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
  /** 首次成功应用时间（T10，IK67H8）；null = 未应用。 */
  applied_at: string | null;
  /** 首个图片 GenerationJob（T10，IK67H8）；null = 未应用。 */
  first_generation_job_id: string | null;
  /** 当前应用可用性（T10，IK67H8）：基于素材可用性 + 能力漂移；snapshot 不查余额，
   *  故不会是 retryable_blocked（仅 available / requires_new_plan）。 */
  application_availability: "available" | "requires_new_plan";
  created_at: string;
}

/** Snapshot 场景卡投影（IK67H9，T11）：视频 SceneCard 的权威正文与版本，供前端渲染与编辑。
 *  生成预设/记录等明细由专属读路径提供，此处只投身份 + 正文。 */
export interface SnapshotSceneCardView {
  scene_card_id: string;
  title: string;
  summary: string | null;
  content_markdown: string;
  version: number;
}

/** Snapshot 计划应用回执投影（IK67H9，T11）：不可变事实，证明正文与参数来自被应用的 PlanMessage。 */
export interface SnapshotPlanApplicationReceiptView {
  receipt_id: string;
  message_id: string;
  application_kind: string;
  scene_card_id: string | null;
  first_generation_job_id: string;
  command_id: string;
  applied_at: string;
}

/** Snapshot 场景卡生成记录投影（IK67HB，T13；IK67HE/T14 增 slots）：generation origins/summaries 恢复权威子集。
 *  完整 Preset 参数不进 Snapshot（省体积），编辑器打开时按需 GET 只读端点。
 *  slots 为该记录下全部 job 的输出槽聚合（含重试 job 的新槽），按 slot_index 升序。 */
export interface SnapshotSceneCardGenerationRecordView {
  record_id: string;
  scene_card_id: string;
  summary_status: string;
  first_generation_job_id: string;
  plan_message_id: string;
  output_slots: SnapshotOutputSlotView[];
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

      // IK67HE/T14：加载该 project 全部输出槽（按 slot_index 升序稳定），按 job 分组附加到 job view。
      const slotRows = await prisma.generation_output_slots.findMany({
        where: { project_id: pid },
        orderBy: [{ generation_job_id: "asc" }, { slot_index: "asc" }, { id: "asc" }],
      });
      const slotsByJob = new Map<string, SnapshotOutputSlotView[]>();
      for (const s of slotRows) {
        const jobId = s.generation_job_id.toString();
        const list = slotsByJob.get(jobId) ?? [];
        list.push({
          slot_id: s.id.toString(),
          slot_index: s.slot_index,
          status: s.status as OutputSlotStatus,
          asset_id: s.asset_id == null ? null : s.asset_id.toString(),
          retry_of_slot_id:
            s.retry_of_slot_id == null ? null : s.retry_of_slot_id.toString(),
          initial_placement_status: s.initial_placement_status as
            | "pending"
            | "placed",
        });
        slotsByJob.set(jobId, list);
      }

      const generation_jobs: SnapshotJobView[] = jobs.map((job) => ({
        job_id: job.id.toString(),
        retry_of_job_id:
          job.retry_of_job_id == null ? null : job.retry_of_job_id.toString(),
        type: job.type,
        source: job.source,
        status: job.status,
        progress: job.progress,
        input: publicGenerationInput(job.input ?? null),
        output_asset_ids: parseAssetIdList(job.output_asset_ids),
        output_slots: slotsByJob.get(job.id.toString()) ?? [],
        stored_error: toStoredError(job.error),
      }));

      return { generation_jobs, assets };
    },
    async loadConversationState(projectId, userId) {
      const pid = BigInt(projectId);
      const uid = BigInt(userId);
      const [messages, mentionRows, runs, inputRequests, planMessageRows, capabilityRows, maxCursorRow, sceneCardRows, applicationRows, recordRows] =
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
          // 能力漂移检测（T10）：按 model_id+capability_type 建表，与冻结快照比对。
          // is_delete=true 的行不返回 → key 缺失即视为漂移。
          prisma.generation_model_capability.findMany({
            where: { is_delete: false },
            select: {
              model_id: true,
              capability_type: true,
              version: true,
              enabled: true,
              is_delete: true,
              supported_sizes: true,
              supported_aspect_ratios: true,
              supported_durations: true,
              supported_formats: true,
              default_size: true,
              default_format: true,
              default_aspect_ratio: true,
              default_duration: true,
            },
          }),
          // cursor 改雪花后 project_event_stream.high_watermark 不再维护；
          // 当前水位直接取 project_events 的最大 cursor。
          prisma.project_events.aggregate({
            where: { project_id: pid, is_delete: 0 },
            _max: { cursor: true },
          }),
          // IK67H9：视频场景卡投影（未删除，按 id 升序）。
          prisma.scene_cards.findMany({
            where: { project_id: pid, is_delete: 0 },
            orderBy: { id: "asc" },
            select: {
              id: true,
              title: true,
              summary: true,
              content_markdown: true,
              version: true,
            },
          }),
          // IK67H9：计划应用回执投影（不可变，按 applied_at 升序）。
          prisma.plan_application_receipts.findMany({
            where: { project_id: pid },
            orderBy: { applied_at: "asc" },
            select: {
              id: true,
              message_id: true,
              application_kind: true,
              scene_card_id: true,
              first_generation_job_id: true,
              command_id: true,
              applied_at: true,
            },
          }),
          // IK67HB：场景卡生成记录投影（未删除，按 id 升序）。
          prisma.scene_card_generation_records.findMany({
            where: { project_id: pid, is_delete: 0 },
            orderBy: { id: "asc" },
            select: {
              id: true,
              scene_card_id: true,
              summary_status: true,
              first_generation_job_id: true,
              plan_message_id: true,
            },
          }),
        ]);
      // IK67HE/T14：查该 project 全部输出槽，按 record 分组附加到 record 投影。
      const allSlotRows = await prisma.generation_output_slots.findMany({
        where: { project_id: pid, scene_card_generation_record_id: { not: null } },
        orderBy: [{ scene_card_generation_record_id: "asc" }, { slot_index: "asc" }, { id: "asc" }],
      });
      const slotsByRecord = new Map<string, SnapshotOutputSlotView[]>();
      for (const s of allSlotRows) {
        const rid = s.scene_card_generation_record_id!.toString();
        const list = slotsByRecord.get(rid) ?? [];
        list.push({
          slot_id: s.id.toString(),
          slot_index: s.slot_index,
          status: s.status as OutputSlotStatus,
          asset_id: s.asset_id == null ? null : s.asset_id.toString(),
          retry_of_slot_id:
            s.retry_of_slot_id == null ? null : s.retry_of_slot_id.toString(),
          initial_placement_status: s.initial_placement_status as
            | "pending"
            | "placed",
        });
        slotsByRecord.set(rid, list);
      }
      for (const [recordId, slots] of slotsByRecord) {
        slotsByRecord.set(recordId, resolveLogicalSlots(slots));
      }
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
      const capabilityByKey = new Map(
        capabilityRows.map((cap) => [
          `${cap.model_id}:${cap.capability_type}`,
          cap,
        ]),
      );
      const mentionById = new Map(
        mentionRows.map((mention) => [mention.id.toString(), mention]),
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
        plan_messages: planMessageRows.map((plan) => {
          const derivedReferences = (
            plan.derived_references ?? []
          ) as DerivedReference[];
          const snapshot =
            plan.capability_snapshot_version as CapabilitySnapshotVersion;
          const cap = capabilityByKey.get(
            `${snapshot.model_id}:${snapshot.capability_type}`,
          );
          // 事实采集收敛到共用 helper：读路径 missingMention="unavailable" 保留原义——
          // 遍历冻结引用列表，取不到 mention 即判失效，前端展示「需重新计划」。
          const { mentionUnavailable, capabilityDrifted } =
            loadPlanApplicationFacts({
              derivedReferences,
              mentionFacts: mentionById,
              assetById,
              missingMention: "unavailable",
              projectId: pid,
              userId: uid,
              capabilitySnapshot: snapshot,
              currentCapability: cap,
            });
          // snapshot 不查余额（balanceSufficient null）→ 不会是 retryable_blocked。
          const availability = classifyPlanApplicationAvailability({
            mentionUnavailable,
            capabilityDrifted,
            balanceSufficient: null,
          });
          return {
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
            applied_at: plan.applied_at?.toISOString() ?? null,
            first_generation_job_id:
              plan.first_generation_job_id?.toString() ?? null,
            application_availability:
              availability === "requires_new_plan"
                ? "requires_new_plan"
                : "available",
            created_at: plan.gmt_create.toISOString(),
          };
        }),
        scene_cards: sceneCardRows.map((card) => ({
          scene_card_id: card.id.toString(),
          title: card.title,
          summary: card.summary,
          content_markdown: card.content_markdown,
          version: card.version,
        })),
        plan_applications: applicationRows.map((receipt) => ({
          receipt_id: receipt.id.toString(),
          message_id: receipt.message_id.toString(),
          application_kind: receipt.application_kind,
          scene_card_id: receipt.scene_card_id?.toString() ?? null,
          first_generation_job_id: receipt.first_generation_job_id.toString(),
          command_id: receipt.command_id,
          applied_at: receipt.applied_at.toISOString(),
        })),
        scene_card_generation_records: recordRows.map((record) => ({
          record_id: record.id.toString(),
          scene_card_id: record.scene_card_id.toString(),
          summary_status: record.summary_status,
          first_generation_job_id: record.first_generation_job_id.toString(),
          plan_message_id: record.plan_message_id.toString(),
          output_slots: slotsByRecord.get(record.id.toString()) ?? [],
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
