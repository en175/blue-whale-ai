import { wallClockRfc3339, wallClockRfc3339OrNull } from "@lib/core";
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
  output_slots: SnapshotOutputSlotView[];
  stored_error: Record<string, unknown> | null;
}

export interface SnapshotAssetRow {
  id: string;
  type: string;
  url: string;
  md5: string | null;
  project_id: string | null;
  material_id: string | null;
  material_status: string | null;
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
  scene_cards: SnapshotSceneCardView[];
  scene_card_generation_records: SnapshotSceneCardGenerationRecordView[];
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

export interface SnapshotSceneCardView {
  scene_card_id: string;
  title: string;
  summary: string | null;
  content_markdown: string;
  version: number;
}

export interface SnapshotSceneCardGenerationRecordView {
  record_id: string;
  scene_card_id: string;
  summary_status: string;
  first_generation_job_id: string;
  output_slots: SnapshotOutputSlotView[];
}

export interface SnapshotStoryboardPreviewView {
  preview_id: string;
  scene_card_id: string;
  first_generation_job_id: string;
  summary_status: string;
}

function parseAssetIdList(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json
    .map((v) =>
      typeof v === "number" || typeof v === "string" ? String(v) : null,
    )
    .filter((v): v is string => v !== null);
}

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

      const linkedAssetIds = (
        await prisma.project_asset.findMany({
          where: { user_id: uid, project_id: pid, is_delete: 0 },
          select: { asset_id: true },
        })
      ).map((r) => r.asset_id);

      const assetRows = await prisma.user_assets.findMany({
        where: {
          user_id: uid,
          status: "normal",
          is_delete: false,
          OR: [
            { id: { in: linkedAssetIds } },
            { project_id: pid },
          ],
        },
      });

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
          material_status: null,
          material_status_checked_at: null,
        });
      }

      const materialIds = [
        ...new Set(
          assets
            .map((a) => a.material_id)
            .filter((id): id is string => id !== null && id.length > 0),
        ),
      ];
      if (materialIds.length > 0) {
        const statusRows = await prisma.catalog_material_states.findMany({
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
          asset.material_status_checked_at = wallClockRfc3339OrNull(row.status_checked_at);
        }
      }

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
          prisma.project_events.aggregate({
            where: { project_id: pid, is_delete: 0 },
            _max: { cursor: true },
          }),
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
          : prisma.user_assets.findMany({
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
          created_at: wallClockRfc3339(message.gmt_create),
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
