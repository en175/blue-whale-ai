import { logger } from "@lib/infra/logging/blue-whale-logger.js";

import {
  createMaterialGate,
  isMaterialLevelRejection,
  type MaterialGate,
  type UpstreamMaterialStatus,
} from "./material-compliance-gate.js";
import type { MaterialAssetRepo } from "@lib/shared/persistence/index.js";


export interface MaterialGateWiringDeps {
  repo: Pick<MaterialAssetRepo, "findByMaterialId" | "mirrorStatus">;
  callAction(
    action: string,
    body: unknown,
  ): Promise<{ status: number; body: unknown }>;
  resolveLocalAssetMaterialIds?(
    userId: string,
    assetIds: readonly string[],
  ): Promise<string[]>;
  onMaterialFailure(input: {
    materialId: string;
    errorCode: string | null;
    errorMessage: string | null;
    deleteUpstream: boolean;
  }): Promise<void>;
}

function readResponseError(body: unknown): Record<string, unknown> | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as Record<string, unknown>).ResponseError;
  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>)
    : null;
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key];
  return typeof value === "string" ? value : null;
}

export function createRequestMaterialGate(
  deps: MaterialGateWiringDeps,
): MaterialGate {
  return createMaterialGate({
    repo: deps.repo,
    fetchUpstreamStatus: async (materialId): Promise<UpstreamMaterialStatus | null> => {
      try {
        const upstream = await deps.callAction("GetAsset", { Id: materialId });
        const body = upstream.body;

        if (upstream.status < 200 || upstream.status >= 300) {
          const error = readResponseError(body);
          const code = readString(error, "Code");
          if (isMaterialLevelRejection(code)) {
            const errorMessage = readString(error, "Message");
            await deps.onMaterialFailure({
              materialId,
              errorCode: code,
              errorMessage,
              deleteUpstream: false,
            });
            return { status: "Failed", errorCode: code, errorMessage };
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
            materialId,
            errorCode,
            errorMessage,
            deleteUpstream: true,
          });
        }
        return { status: rec.Status, errorCode, errorMessage };
      } catch (error) {
        logger.warn(
          `[generation] 素材状态实时查询失败 materialId=${materialId}，按不可用处理: ${
            error instanceof Error ? error.message : "unknown"
          }`,
        );
        return null;
      }
    },
    ...(deps.resolveLocalAssetMaterialIds
      ? { resolveLocalAssetMaterialIds: deps.resolveLocalAssetMaterialIds }
      : {}),
  });
}
