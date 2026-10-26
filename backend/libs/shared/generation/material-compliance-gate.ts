import type { MaterialAssetRepo } from "@lib/shared/persistence/index.js";
import type { MaterialGate } from "./handle-create-generation-job.js";

export type { MaterialGate };


export interface UpstreamMaterialStatus {
  status: string;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface MaterialComplianceDeps {
  repo: Pick<MaterialAssetRepo, "findByMaterialId" | "mirrorStatus">;
  fetchUpstreamStatus(
    materialId: string,
  ): Promise<UpstreamMaterialStatus | null>;
}

export type MaterialGateResult =
  | { ok: true }
  | { ok: false; message: string };

export const MATERIAL_NOT_APPROVED_MESSAGE = "该素材未审核通过，不能用于视频生成";

export const MATERIAL_STATUS_UNAVAILABLE_MESSAGE = "素材状态校验失败，请稍后重试";

const MATERIAL_LEVEL_REJECTION_CODE = /^(?:NotFound|InvalidParameter)\.asset/i;

export function isMaterialLevelRejection(
  code: string | null | undefined,
): boolean {
  return typeof code === "string" && MATERIAL_LEVEL_REJECTION_CODE.test(code);
}

function normalizeStatus(raw: string): "Active" | "Failed" | "Processing" {
  return raw === "Active" || raw === "Failed" ? raw : "Processing";
}

export async function assertMaterialsUsable(
  deps: MaterialComplianceDeps,
  userId: string,
  materialIds: readonly string[],
): Promise<MaterialGateResult> {
  for (const materialId of materialIds) {
    const row = await deps.repo.findByMaterialId(userId, materialId);

    if (row !== null && row.status !== "Processing") {
      if (row.status !== "Active") {
        return { ok: false, message: MATERIAL_NOT_APPROVED_MESSAGE };
      }
      continue;
    }

    const upstream = await deps.fetchUpstreamStatus(materialId);
    if (upstream === null) {
      return { ok: false, message: MATERIAL_STATUS_UNAVAILABLE_MESSAGE };
    }
    const status = normalizeStatus(upstream.status);
    if (row !== null) {
      await deps.repo.mirrorStatus({
        userId,
        materialId,
        status,
        errorCode: upstream.errorCode ?? null,
        errorMessage: upstream.errorMessage ?? null,
      });
    }
    if (status !== "Active") {
      return { ok: false, message: MATERIAL_NOT_APPROVED_MESSAGE };
    }
  }
  return { ok: true };
}

export function collectMaterialIds(input: {
  references?: readonly { material_id?: unknown }[] | undefined;
  firstFrameMaterialId?: unknown;
  lastFrameMaterialId?: unknown;
  referenceMaterials?: readonly { id?: unknown }[] | undefined;
  materialIdsFromLocalAssets?: readonly string[];
}): string[] {
  const out: string[] = [];
  const push = (raw: unknown) => {
    if (typeof raw === "string" && raw.length > 0) out.push(raw);
  };
  for (const item of input.references ?? []) push(item?.material_id);
  push(input.firstFrameMaterialId);
  push(input.lastFrameMaterialId);
  for (const item of input.referenceMaterials ?? []) push(item?.id);
  for (const id of input.materialIdsFromLocalAssets ?? []) push(id);
  return [...new Set(out)];
}

export function collectLocalAssetIds(input: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (raw: unknown) => {
    if (typeof raw === "string" && /^\d+$/.test(raw)) out.push(raw);
  };
  if (Array.isArray(input.references)) {
    for (const item of input.references) {
      if (item !== null && typeof item === "object") {
        push((item as Record<string, unknown>).asset_id);
      }
    }
  }
  push(input.first_frame_asset_id);
  push(input.last_frame_asset_id);
  if (Array.isArray(input.reference_asset_ids)) {
    for (const id of input.reference_asset_ids) push(id);
  }
  return [...new Set(out)];
}

export function createMaterialGate(deps: {
  repo: Pick<MaterialAssetRepo, "findByMaterialId" | "mirrorStatus">;
  fetchUpstreamStatus: (
    materialId: string,
  ) => Promise<UpstreamMaterialStatus | null>;
  resolveLocalAssetMaterialIds?: (
    userId: string,
    assetIds: readonly string[],
  ) => Promise<string[]>;
}): MaterialGate {
  return {
    async assertInputUsable({ userId, jobInput, jobType }): Promise<string | null> {
      if (jobType !== "video") return null;

      const localAssetIds = collectLocalAssetIds(jobInput);
      const materialIdsFromLocalAssets =
        deps.resolveLocalAssetMaterialIds && localAssetIds.length > 0
          ? await deps.resolveLocalAssetMaterialIds(userId, localAssetIds)
          : [];
      const materialIds = collectMaterialIds({
        references: Array.isArray(jobInput.references)
          ? (jobInput.references as readonly { material_id?: unknown }[])
          : undefined,
        firstFrameMaterialId: jobInput.first_frame_material_id,
        lastFrameMaterialId: jobInput.last_frame_material_id,
        referenceMaterials: Array.isArray(jobInput.reference_materials)
          ? (jobInput.reference_materials as readonly { id?: unknown }[])
          : undefined,
        materialIdsFromLocalAssets,
      });
      if (materialIds.length === 0) return null;
      const result = await assertMaterialsUsable(deps, userId, materialIds);
      return result.ok ? null : result.message;
    },
  };
}
