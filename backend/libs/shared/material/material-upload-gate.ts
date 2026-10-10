import {
  MATERIAL_NOT_APPROVED_MESSAGE,
  MATERIAL_STATUS_UNAVAILABLE_MESSAGE,
  isMaterialLevelRejection,
} from "@lib/shared/generation/material-compliance-gate.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import type { MaterialAssetRepo } from "@lib/shared/persistence/index.js";


export interface UpstreamMaterialAsset {
  status: string;
  groupId: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface UploadMaterialGateResult {
  ok: true;
}
export type UploadMaterialGateOutcome =
  | UploadMaterialGateResult
  | {
      ok: false;
      reason: UploadMaterialGateFailureReason;
      message: string;
    };

export type UploadMaterialGateFailureReason =
  | "not_approved"
  | "pending"
  | "unavailable";

export interface UploadMaterialGateDeps {
  repo: Pick<
    MaterialAssetRepo,
    "findByMaterialId" | "mirrorStatus" | "upsertProcessing"
  >;
  fetchUpstream(materialId: string): Promise<UpstreamMaterialAsset | null>;
}

function normalizeStatus(raw: string): "Active" | "Failed" | "Processing" {
  return raw === "Active" || raw === "Failed" ? raw : "Processing";
}

export async function assertMaterialLinkable(
  deps: UploadMaterialGateDeps,
  userId: string,
  materialId: string,
): Promise<UploadMaterialGateOutcome> {
  const row = await deps.repo.findByMaterialId(userId, materialId);

  if (row !== null && row.status !== "Processing") {
    return row.status === "Active"
      ? { ok: true }
      : {
          ok: false,
          reason: "not_approved",
          message: MATERIAL_NOT_APPROVED_MESSAGE,
        };
  }

  const upstream = await deps.fetchUpstream(materialId);
  if (upstream === null) {
    return {
      ok: false,
      reason: "unavailable",
      message: MATERIAL_STATUS_UNAVAILABLE_MESSAGE,
    };
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
  } else if (upstream.groupId) {
    await deps.repo.upsertProcessing({
      userId,
      materialId,
      materialGroupId: upstream.groupId,
    });
    if (status !== "Processing") {
      await deps.repo.mirrorStatus({
        userId,
        materialId,
        status,
        errorCode: upstream.errorCode ?? null,
        errorMessage: upstream.errorMessage ?? null,
      });
    }
  } else {
    logger.warn(
      `[upload] 素材无本地状态行且上游未返回 GroupId，跳过补行 materialId=${materialId}`,
    );
  }

  if (status !== "Active") {
    return {
      ok: false,
      reason: status === "Failed" ? "not_approved" : "pending",
      message: MATERIAL_NOT_APPROVED_MESSAGE,
    };
  }
  return { ok: true };
}

export interface UploadMaterialGateWiringDeps {
  repo: UploadMaterialGateDeps["repo"];
  callAction(
    action: string,
    body: unknown,
  ): Promise<{ status: number; body: unknown }>;
  onMaterialFailure(input: {
    userId: string;
    materialId: string;
    errorCode: string | null;
    errorMessage: string | null;
    deleteUpstream: boolean;
  }): Promise<void>;
}

export function readResponseError(body: unknown): Record<string, unknown> | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as Record<string, unknown>).ResponseError;
  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>)
    : null;
}

function readString(
  source: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = source?.[key];
  return typeof value === "string" ? value : null;
}

export function createUploadMaterialGate(
  deps: UploadMaterialGateWiringDeps,
): {
  check(userId: string, materialId: string): Promise<UploadMaterialGateOutcome>;
} {
  return {
    check: async (userId, materialId) => {
      const gateDeps: UploadMaterialGateDeps = {
        repo: deps.repo,
        fetchUpstream: async (id) => {
          try {
            const upstream = await deps.callAction("GetAsset", { Id: id });
            const body = upstream.body;

            if (upstream.status < 200 || upstream.status >= 300) {
              const error = readResponseError(body);
              const code = readString(error, "Code");
              if (isMaterialLevelRejection(code)) {
                const errorMessage = readString(error, "Message");
                await deps.onMaterialFailure({
                  userId,
                  materialId: id,
                  errorCode: code,
                  errorMessage,
                  deleteUpstream: false,
                });
                return { status: "Failed", groupId: null, errorCode: code, errorMessage };
              }
              return null;
            }

            const result =
              typeof body === "object" && body !== null
                ? (body as Record<string, unknown>).Result
                : undefined;
            if (typeof result !== "object" || result === null) return null;
            const rec = result as Record<string, unknown>;
            if (typeof rec.Status !== "string") return null;

            const error =
              typeof rec.Error === "object" && rec.Error !== null
                ? (rec.Error as Record<string, unknown>)
                : null;
            const errorCode = readString(error, "Code");
            const errorMessage = readString(error, "Message");

            if (rec.Status === "Failed") {
              await deps.onMaterialFailure({
                userId,
                materialId: id,
                errorCode,
                errorMessage,
                deleteUpstream: true,
              });
            }
            return {
              status: rec.Status,
              groupId: readString(rec, "GroupId"),
              errorCode,
              errorMessage,
            };
          } catch (error) {
            logger.warn(
              `[upload] 素材状态实时查询失败 materialId=${id}，按不可用处理: ${
                error instanceof Error ? error.message : "unknown"
              }`,
            );
            return null;
          }
        },
      };
      return assertMaterialLinkable(gateDeps, userId, materialId);
    },
  };
}
