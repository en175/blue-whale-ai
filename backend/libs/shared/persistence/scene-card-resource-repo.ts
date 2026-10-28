import type { Prisma, PrismaClient } from "@prisma/client";

import { transactionWithUniqueRetry } from "./conversation-repo.js";

export type SceneCardResourceResult =
  | {
      kind: "found";
      scene_card_id: string;
      project_id: string;
      title: string;
      summary: string | null;
      content_markdown: string;
      version: number;
    }
  | { kind: "not_found" };

export interface DeleteSceneCardResourceInput {
  userId: string;
  sceneCardId: string;
  expectedVersion: number;
  idempotencyKey: string;
  requestHash: string;
}

export type DeleteSceneCardResourceResult =
  | { kind: "deleted" }
  | { kind: "replayed" }
  | { kind: "not_found" }
  | { kind: "version_conflict"; current_version: number }
  | { kind: "idempotency_conflict" };

export interface SceneCardSharedSnapshotSource {
  title: string;
  summary: string | null;
  content_markdown: string;
  generation_preset: {
    parameters: unknown;
    reference_mode: string;
    reference_assets: unknown[];
    capability_snapshot_version: unknown;
  } | null;
}

export type FindOwnedSceneCardWithPresetResult =
  | { kind: "found"; scene_card: SceneCardSharedSnapshotSource }
  | { kind: "not_found" };

export interface CopySceneCardToProjectInput {
  userId: string;
  projectId: string;
  title: string;
  summary: string | null;
  content_markdown: string;
  generation_preset: {
    parameters: unknown;
    reference_mode: string;
    reference_assets: unknown[];
    capability_snapshot_version: unknown;
  } | null;
}

export type CopySceneCardToProjectResult =
  | { kind: "copied"; scene_card_id: string }
  | { kind: "project_not_found" };

export interface SceneCardResourceRepo {
  getSceneCardResource(
    userId: string,
    sceneCardId: string,
  ): Promise<SceneCardResourceResult>;
  deleteSceneCardResource(
    input: DeleteSceneCardResourceInput,
  ): Promise<DeleteSceneCardResourceResult>;
  findOwnedSceneCardWithPreset(
    userId: string,
    sceneCardId: string,
  ): Promise<FindOwnedSceneCardWithPresetResult>;
  copySceneCardToProject(
    input: CopySceneCardToProjectInput,
  ): Promise<CopySceneCardToProjectResult>;
}

const DELETE_OPERATION = "scene_card.delete";

async function deleteInTransaction(
  tx: Prisma.TransactionClient,
  input: DeleteSceneCardResourceInput,
): Promise<DeleteSceneCardResourceResult> {
  const sceneCardId = BigInt(input.sceneCardId);
  const sceneCard = await tx.scene_cards.findFirst({
    where: { id: sceneCardId },
    select: { id: true, project_id: true, version: true, is_delete: true },
  });
  if (!sceneCard) return { kind: "not_found" };
  const project = await tx.project.findFirst({
    where: {
      id: sceneCard.project_id,
      owner_id: BigInt(input.userId),
      is_delete: 0,
    },
    select: { id: true },
  });
  if (!project) return { kind: "not_found" };

  const existing = await tx.project_command_receipts.findUnique({
    where: {
      project_id_operation_idempotency_key: {
        project_id: sceneCard.project_id,
        operation: DELETE_OPERATION,
        idempotency_key: input.idempotencyKey,
      },
    },
    select: { request_hash: true, resource_id: true },
  });
  if (existing) {
    return existing.request_hash === input.requestHash &&
      existing.resource_id === sceneCardId
      ? { kind: "replayed" }
      : { kind: "idempotency_conflict" };
  }
  if (sceneCard.is_delete !== 0) return { kind: "not_found" };
  if (sceneCard.version !== input.expectedVersion) {
    return { kind: "version_conflict", current_version: sceneCard.version };
  }

  const updated = await tx.scene_cards.updateMany({
    where: { id: sceneCardId, version: input.expectedVersion, is_delete: 0 },
    data: {
      is_delete: 1,
      version: { increment: 1 },
      gmt_modified: new Date(),
    },
  });
  if (updated.count !== 1) {
    const current = await tx.scene_cards.findFirst({
      where: { id: sceneCardId },
      select: { version: true },
    });
    return {
      kind: "version_conflict",
      current_version: current?.version ?? sceneCard.version,
    };
  }
  await tx.project_command_receipts.create({
    data: {
      project_id: sceneCard.project_id,
      operation: DELETE_OPERATION,
      idempotency_key: input.idempotencyKey,
      request_hash: input.requestHash,
      resource_id: sceneCardId,
      accepted_cursor: 0n,
    },
  });
  return { kind: "deleted" };
}

export function createSceneCardResourceRepo(
  prisma: PrismaClient,
): SceneCardResourceRepo {
  return {
    getSceneCardResource(userId, sceneCardId) {
      return prisma.$transaction(async (tx) => {
        const sceneCard = await tx.scene_cards.findFirst({
          where: { id: BigInt(sceneCardId), is_delete: 0 },
          select: {
            id: true,
            project_id: true,
            title: true,
            summary: true,
            content_markdown: true,
            version: true,
          },
        });
        if (!sceneCard) return { kind: "not_found" };
        const project = await tx.project.findFirst({
          where: {
            id: sceneCard.project_id,
            owner_id: BigInt(userId),
            is_delete: 0,
          },
          select: { id: true },
        });
        if (!project) return { kind: "not_found" };
        return {
          kind: "found",
          scene_card_id: sceneCard.id.toString(),
          project_id: sceneCard.project_id.toString(),
          title: sceneCard.title,
          summary: sceneCard.summary,
          content_markdown: sceneCard.content_markdown,
          version: sceneCard.version,
        };
      });
    },
    deleteSceneCardResource(input) {
      return transactionWithUniqueRetry(prisma, (tx) =>
        deleteInTransaction(tx, input),
      );
    },
    async findOwnedSceneCardWithPreset(userId, sceneCardId) {
      const sceneCard = await prisma.scene_cards.findFirst({
        where: { id: BigInt(sceneCardId), is_delete: 0 },
        select: {
          id: true,
          project_id: true,
          title: true,
          summary: true,
          content_markdown: true,
        },
      });
      if (!sceneCard) return { kind: "not_found" };
      const project = await prisma.project.findFirst({
        where: {
          id: sceneCard.project_id,
          owner_id: BigInt(userId),
          is_delete: 0,
        },
        select: { id: true },
      });
      if (!project) return { kind: "not_found" };
      const preset = await prisma.scene_card_generation_presets.findFirst({
        where: { scene_card_id: sceneCard.id, is_delete: 0 },
        select: {
          parameters: true,
          reference_mode: true,
          reference_assets: true,
          capability_snapshot_version: true,
        },
      });
      return {
        kind: "found",
        scene_card: {
          title: sceneCard.title,
          summary: sceneCard.summary,
          content_markdown: sceneCard.content_markdown,
          generation_preset: preset
            ? {
                parameters: preset.parameters,
                reference_mode: preset.reference_mode,
                reference_assets: preset.reference_assets as unknown[],
                capability_snapshot_version: preset.capability_snapshot_version,
              }
            : null,
        },
      };
    },
    async copySceneCardToProject(input) {
      return prisma.$transaction(async (tx) => {
        const project = await tx.project.findFirst({
          where: {
            id: BigInt(input.projectId),
            owner_id: BigInt(input.userId),
            is_delete: 0,
          },
          select: { id: true },
        });
        if (!project) return { kind: "project_not_found" };
        const sceneCard = await tx.scene_cards.create({
          data: {
            project_id: BigInt(input.projectId),
            title: input.title,
            summary: input.summary,
            content_markdown: input.content_markdown,
          },
          select: { id: true },
        });
        if (input.generation_preset) {
          await tx.scene_card_generation_presets.create({
            data: {
              scene_card_id: sceneCard.id,
              project_id: BigInt(input.projectId),
              parameters: input.generation_preset.parameters as Prisma.InputJsonValue,
              reference_mode: input.generation_preset.reference_mode,
              reference_assets: input.generation_preset
                .reference_assets as Prisma.InputJsonValue,
              capability_snapshot_version: input.generation_preset
                .capability_snapshot_version as Prisma.InputJsonValue,
            },
          });
        }
        return { kind: "copied", scene_card_id: sceneCard.id.toString() };
      });
    },
  };
}
