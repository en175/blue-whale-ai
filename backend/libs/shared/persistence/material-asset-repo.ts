import type { PrismaClient } from "@prisma/client";


export type MaterialAssetStatus = "Processing" | "Active" | "Failed";

export interface MaterialAssetView {
  id: string;
  materialId: string;
  userId: string;
  materialGroupId: string;
  status: MaterialAssetStatus;
  errorCode: string | null;
  errorMessage: string | null;
  statusCheckedAt: Date | null;
}

export interface UpsertProcessingInput {
  userId: string;
  materialId: string;
  materialGroupId: string;
}

export interface MirrorStatusInput {
  userId: string;
  materialId: string;
  status: MaterialAssetStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  checkedAt?: Date;
}

export interface MaterialAssetRepo {
  upsertProcessing(input: UpsertProcessingInput): Promise<void>;
  findByMaterialId(userId: string, materialId: string): Promise<MaterialAssetView | null>;
  mirrorStatus(input: MirrorStatusInput): Promise<void>;
  deleteByMaterialId(userId: string, materialId: string): Promise<void>;
  deleteByGroupId(userId: string, materialGroupId: string): Promise<void>;
}

function toStatus(raw: string): MaterialAssetStatus {
  if (raw === "Active" || raw === "Failed") return raw;
  return "Processing";
}

function toView(row: {
  id: bigint;
  material_id: string;
  user_id: bigint;
  material_group_id: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  status_checked_at: Date | null;
}): MaterialAssetView {
  return {
    id: row.id.toString(),
    materialId: row.material_id,
    userId: row.user_id.toString(),
    materialGroupId: row.material_group_id,
    status: toStatus(row.status),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    statusCheckedAt: row.status_checked_at,
  };
}

export function createMaterialAssetRepo(
  prisma: PrismaClient,
): MaterialAssetRepo {
  return {
    async upsertProcessing({ userId, materialId, materialGroupId }) {
      await prisma.user_material_info.upsert({
        where: { material_id: materialId },
        update: {
          material_group_id: materialGroupId,
          status: "Processing",
          error_code: null,
          error_message: null,
          version: { increment: 1 },
          gmt_modified: new Date(),
        },
        create: {
          material_id: materialId,
          user_id: BigInt(userId),
          material_group_id: materialGroupId,
          status: "Processing",
        },
      });
    },
    async findByMaterialId(userId, materialId) {
      const row = await prisma.user_material_info.findFirst({
        where: { material_id: materialId, user_id: BigInt(userId) },
      });
      return row ? toView(row) : null;
    },
    async mirrorStatus({
      userId,
      materialId,
      status,
      errorCode,
      errorMessage,
      checkedAt,
    }) {
      await prisma.user_material_info.updateMany({
        where: {
          material_id: materialId,
          user_id: BigInt(userId),
          ...(status === "Failed" ? {} : { status: { not: "Failed" } }),
        },
        data: {
          status,
          error_code: errorCode ?? null,
          error_message: errorMessage ?? null,
          status_checked_at: checkedAt ?? new Date(),
          version: { increment: 1 },
          gmt_modified: new Date(),
        },
      });
    },
    async deleteByMaterialId(userId, materialId) {
      await prisma.user_material_info.deleteMany({
        where: { material_id: materialId, user_id: BigInt(userId) },
      });
    },
    async deleteByGroupId(userId, materialGroupId) {
      await prisma.user_material_info.deleteMany({
        where: { material_group_id: materialGroupId, user_id: BigInt(userId) },
      });
    },
  };
}
