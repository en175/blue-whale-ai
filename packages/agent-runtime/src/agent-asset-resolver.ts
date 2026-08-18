import { createHash } from "node:crypto";
import { z } from "zod";

const decimalIdSchema = z.string().regex(/^[1-9][0-9]*$/);

export const agentAssetResolveRequestSchema = z
  .object({
    asset_id: decimalIdSchema,
    asset_version: z.string().min(1).max(191),
  })
  .strict();

export type AgentAssetResolveRequest = z.infer<
  typeof agentAssetResolveRequestSchema
>;

export const agentAssetResolveResultSchema = z
  .object({
    asset_id: decimalIdSchema,
    asset_version: z.string().min(1).max(191),
    media_type: z.enum(["image", "video"]),
    mime_type: z.string().min(1),
    size_bytes: z.number().int().nonnegative(),
    duration_seconds: z.number().nonnegative().nullable(),
    read_url: z.string().url(),
    expires_at: z.string().datetime(),
  })
  .strict();

export type AgentAssetResolveResult = z.infer<
  typeof agentAssetResolveResultSchema
>;

export interface AgentReadableAsset {
  storage_key: string | null;
  content_sha256: string | null;
  type: string;
  mime: string | null;
  size: bigint | null;
  duration_seconds: number | null;
}

export type AgentAssetResolveRejection =
  | "asset_inaccessible"
  | "asset_version_mismatch"
  | "asset_metadata_unavailable"
  | "storage_access_unavailable";

export type AgentAssetResolveOutcome =
  | { kind: "ok"; value: AgentAssetResolveResult }
  | { kind: "rejected"; reason: AgentAssetResolveRejection };

export interface AgentAssetResolverDeps {
  findAccessible(
    projectId: string,
    assetId: string,
    userId: string,
  ): Promise<AgentReadableAsset | null>;
  sign(
    storageKey: string,
  ): Promise<{ url: string; expiresAt: Date }>;
}

/**
 * Derives an opaque fingerprint from immutable storage identity and stable content facts.
 * A recorded SHA-256 strengthens the identity when available, but old Assets remain resolvable.
 */
export function deriveAssetContentVersion(asset: AgentReadableAsset): string {
  const canonical = JSON.stringify({
    storage_key: asset.storage_key,
    content_sha256: asset.content_sha256,
    type: asset.type,
    mime: asset.mime,
    size: asset.size?.toString() ?? null,
    duration_seconds: asset.duration_seconds,
  });
  return `av1_${createHash("sha256").update(canonical).digest("base64url")}`;
}

/** Resolves one currently-owned Asset into transient, read-only model input. */
export async function resolveAgentAsset(
  request: AgentAssetResolveRequest,
  owner: { userId: string; projectId: string },
  deps: AgentAssetResolverDeps,
): Promise<AgentAssetResolveOutcome> {
  const asset = await deps.findAccessible(
    owner.projectId,
    request.asset_id,
    owner.userId,
  );
  if (!asset) return { kind: "rejected", reason: "asset_inaccessible" };

  const currentVersion = deriveAssetContentVersion(asset);
  if (currentVersion !== request.asset_version) {
    return { kind: "rejected", reason: "asset_version_mismatch" };
  }

  if (
    !asset.storage_key ||
    !asset.mime ||
    asset.size === null ||
    asset.size < 0n ||
    asset.size > BigInt(Number.MAX_SAFE_INTEGER) ||
    (asset.type !== "image" && asset.type !== "video")
  ) {
    return { kind: "rejected", reason: "asset_metadata_unavailable" };
  }

  let signed: Awaited<ReturnType<AgentAssetResolverDeps["sign"]>>;
  try {
    signed = await deps.sign(asset.storage_key);
  } catch {
    return { kind: "rejected", reason: "storage_access_unavailable" };
  }

  const parsed = agentAssetResolveResultSchema.safeParse({
    asset_id: request.asset_id,
    asset_version: currentVersion,
    media_type: asset.type,
    mime_type: asset.mime,
    size_bytes: Number(asset.size),
    duration_seconds: asset.duration_seconds,
    read_url: signed.url,
    expires_at: signed.expiresAt.toISOString(),
  });
  if (!parsed.success) {
    return { kind: "rejected", reason: "storage_access_unavailable" };
  }
  return { kind: "ok", value: parsed.data };
}
