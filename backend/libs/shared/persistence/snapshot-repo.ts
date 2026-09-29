import type { PrismaClient } from "@prisma/client";
import {
  type ConversationMentionType,
  type MentionFailureReason,
} from "@lib/core";

import { publicGenerationInput } from "./generation-input.js";
import { classifyMentionAvailability } from "./mention-availability.js";
import {
  resolveLogicalSlots,
  type OutputSlotStatus,
} from "./generation-output-slot-repo.js";

/** Snapshot 读路径的 job + asset 聚合 db port（Prisma-backed）。
 *  对齐 Java SnapshotService 项目级 GenerationJob 与 Asset 引用读取：
 *  - generation_jobs 按 project_id 过滤、gmt_create desc。
 *  - 按 project_id 一次读取全部 normal assets（包含上传与生成产物，防 N+1）。
 *  对齐部署 schema：conversation_messages / generation_job_outputs /
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
  /** 素材内容 md5。渐入期老资产未落 md5，可空；写入侧不保证小写，比对需大小写不敏感。 */
  md5: string | null;
  /** assets.project_id 在部署 schema 非空（默认 0）；理论可空时按全局 asset 处理。 */
  project_id: string | null;
  /** IKEXX8：素材库关联两列成对携带（未关联为 null）。 */
  material_id: string | null;
  material_group_id: string | null;
  /** IKFYHJ：素材校验状态（ADR-0087）。
   *  取自本地镜像表，**不在这里查上游**——snapshot 是打开画布必走的读路径，
   *  按素材数扇出 GetAsset 会把一次开页变成 N 次上游往返。
   *  null = 没关联素材库、或关联了但本地无镜像行（早于本功能入库的存量素材）。
   *  判定「此刻能不能用」以生成接口为准，本字段只作首屏展示。 */
  material_status: string | null;
  /** 该状态最后一次向上游确认的时刻（ISO 或 null）——前端据此判断镜像是否已经陈旧。 */
  material_status_checked_at: string | null;
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
  /** 已创建的视频场景卡（IK67H9，T11）：按 id 升序。 */
  scene_cards: SnapshotSceneCardView[];
  /** SceneCard 生成记录（IK67HB，T13）：generation origins/summaries 恢复权威子集，按 id 升序。 */
  scene_card_generation_records: SnapshotSceneCardGenerationRecordView[];
  /** StoryboardPreview 分镜预览（IK67HF，T15）：从 SceneCard 触发的可选旁路预览会话，按 id 升序。 */
  storyboard_previews: SnapshotStoryboardPreviewView[];
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

/** Snapshot 场景卡投影（IK67H9，T11）：视频 SceneCard 的权威正文与版本，供前端渲染与编辑。
 *  生成预设/记录等明细由专属读路径提供，此处只投身份 + 正文。 */
export interface SnapshotSceneCardView {
  scene_card_id: string;
  title: string;
  summary: string | null;
  content_markdown: string;
  version: number;
}

/** Snapshot 场景卡生成记录投影（IK67HB，T13；IK67HE/T14 增 slots）：generation origins/summaries 恢复权威子集。
 *  完整 Preset 参数不进 Snapshot（省体积），编辑器打开时按需 GET 只读端点。
 *  slots 为该记录下全部 job 的输出槽聚合（含重试 job 的新槽），按 slot_index 升序。 */
export interface SnapshotSceneCardGenerationRecordView {
  record_id: string;
  scene_card_id: string;
  summary_status: string;
  first_generation_job_id: string;
  output_slots: SnapshotOutputSlotView[];
}

/** Snapshot 分镜预览投影（IK67HF，T15）：可选旁路预览会话恢复权威子集，按 id 升序。
 *  画格（output_slots → Asset）通过 first_generation_job_id 关联 GenerationJob 取，不在此视图重复。 */
export interface SnapshotStoryboardPreviewView {
  preview_id: string;
  scene_card_id: string;
  first_generation_job_id: string;
  summary_status: string;
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

      // IKCNLP（方案C）：本项目可用的素材 = project_asset 关联的 asset + 直接归属本项目(project_id=pid)的 asset。
      // 画布节点引用的素材若不在其中，前端据此判定失效并显示占位图。
      const linkedAssetIds = (
        await prisma.project_asset.findMany({
          where: { user_id: uid, project_id: pid, is_delete: 0 },
          select: { asset_id: true },
        })
      ).map((r) => r.asset_id);

      const assetRows = await prisma.assets.findMany({
        where: {
          user_id: uid,
          status: "normal",
          is_delete: false,
          OR: [
            { id: { in: linkedAssetIds } },
            { project_id: pid }, // 兼容：本项目单值归属的素材（渐入期关联表未覆盖的）
          ],
        },
      });

      // 对齐 Java：仅保留归属本项目的 asset、或已被本项目 project_asset 关联的 asset。
      // 关联命中的 asset 即使 assets.project_id 指向别项目（跨项目复用）也保留——它是本项目显式关联的素材。
      // 用 seenIds 去重：同一素材可能同时命中多个 OR 分支（如既被关联又 project_id=pid），
      // 显式保证一个项目里同一素材只出现一次，不依赖 SQL WHERE OR 的隐式单次语义。
      const linkedSet = new Set(linkedAssetIds.map((id) => id.toString()));
      const seenIds = new Set<string>();
      const assets: SnapshotAssetRow[] = [];
      for (const a of assetRows) {
        const idStr = a.id.toString();
        if (seenIds.has(idStr)) continue;
        const rowProjectId =
          a.project_id == null ? null : a.project_id.toString();
        const isLinked = linkedSet.has(idStr);
        if (!isLinked && rowProjectId !== null && rowProjectId !== projectId) {
          continue;
        }
        seenIds.add(idStr);
        assets.push({
          id: idStr,
          type: a.type,
          url: a.url,
          md5: a.md5 ?? null,
          project_id: rowProjectId,
          material_id: a.material_id ?? null,
          material_group_id: a.material_group_id ?? null,
          material_status: null,
          material_status_checked_at: null,
        });
      }

      // IKFYHJ：一次性批量取这批 asset 关联素材的校验状态（ADR-0087），回填到 asset 行。
      // 单条 IN 查询，不做 N+1、不打上游——见 SnapshotAssetRow 的字段注释。
      // 带 user_id 谓词（决策 1 的纵深防御）。
      const materialIds = [
        ...new Set(
          assets
            .map((a) => a.material_id)
            .filter((id): id is string => id !== null && id.length > 0),
        ),
      ];
      if (materialIds.length > 0) {
        const statusRows = await prisma.material_assets.findMany({
          where: { user_id: uid, material_id: { in: materialIds } },
          select: {
            material_id: true,
            status: true,
            status_checked_at: true,
          },
        });
        const statusByMaterial = new Map(
          statusRows.map((r) => [r.material_id, r]),
        );
        for (const asset of assets) {
          if (asset.material_id === null) continue;
          const row = statusByMaterial.get(asset.material_id);
          if (!row) continue;
          asset.material_status = row.status;
          asset.material_status_checked_at =
            row.status_checked_at === null
              ? null
              : row.status_checked_at.toISOString();
        }
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
      // IKEEFV：conversation_message_mentions 表已删（唯一写入点 acceptConversationMessageInTransaction
      // 随 IKCKOW 旧引擎移除，删除时全库 0 行）。引用事实不再存在：message.mentions 恒为空，
      // plan 冻结引用取不到 mention → 维持 missingMention="unavailable"（前端「需重新计划」）原语义。
      // SceneCard 迁移（IKDMQM）重新定义引用来源后按需恢复本投影。
      const mentionRows: Array<{
        id: bigint;
        message_id: bigint;
        accepted_user_id: bigint;
        mention_seq: number;
        mention_type: ConversationMentionType;
        target_id: bigint;
        target_version: number | null;
        display_name: string;
        snapshot: unknown;
      }> = [];
      const [messages, maxCursorRow, sceneCardRows, recordRows, previewRows] =
        await Promise.all([
          prisma.conversation_messages.findMany({
            where: { project_id: pid, is_delete: 0 },
            orderBy: { sequence_no: "asc" },
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
          // IK67HB：场景卡生成记录投影（未删除，按 id 升序）。
          prisma.scene_card_generation_records.findMany({
            where: { project_id: pid, is_delete: 0 },
            orderBy: { id: "asc" },
            select: {
              id: true,
              scene_card_id: true,
              summary_status: true,
              first_generation_job_id: true,
            },
          }),
          // IK67HF：分镜预览投影（未删除，按 id 升序）。画格经 first_generation_job_id 关联 job 取。
          prisma.storyboard_previews.findMany({
            where: { project_id: pid, is_delete: 0 },
            orderBy: { id: "asc" },
            select: {
              id: true,
              scene_card_id: true,
              first_generation_job_id: true,
              summary_status: true,
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
        scene_cards: sceneCardRows.map((card) => ({
          scene_card_id: card.id.toString(),
          title: card.title,
          summary: card.summary,
          content_markdown: card.content_markdown,
          version: card.version,
        })),
        scene_card_generation_records: recordRows.map((record) => ({
          record_id: record.id.toString(),
          scene_card_id: record.scene_card_id.toString(),
          summary_status: record.summary_status,
          first_generation_job_id: record.first_generation_job_id.toString(),
          output_slots: slotsByRecord.get(record.id.toString()) ?? [],
        })),
        storyboard_previews: previewRows.map((preview) => ({
          preview_id: preview.id.toString(),
          scene_card_id: preview.scene_card_id.toString(),
          first_generation_job_id: preview.first_generation_job_id.toString(),
          summary_status: preview.summary_status,
        })),
        high_watermark_cursor: (maxCursorRow?._max?.cursor ?? 0n).toString(),
      };
    },
  };
}
