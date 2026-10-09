import { z } from "zod";

const decimalIdSchema = z.string().regex(/^[1-9][0-9]*$/);

export const agentAssetResolveRequestSchema = z
  .object({
    asset_id: decimalIdSchema,
  })
  .strict();

export type AgentAssetResolveRequest = z.infer<
  typeof agentAssetResolveRequestSchema
>;

export const agentAssetResolveResultSchema = z
  .object({
    asset_id: decimalIdSchema,
    media_type: z.enum(["image", "video"]),
    mime_type: z.string().min(1),
    size_bytes: z.number().int().nonnegative(),
    duration_seconds: z.number().nonnegative().nullable(),
    read_url: z.string().url(),
    probe_url: z.string().url(),
    expires_at: z.string().datetime(),
  })
  .strict();

export type AgentAssetResolveResult = z.infer<
  typeof agentAssetResolveResultSchema
>;

export interface AgentReadableAsset {
  storage_key: string | null;
  type: string;
  mime: string | null;
  size: bigint | null;
  duration_seconds: number | null;
}

export type AgentAssetResolveRejection =
  | "asset_inaccessible"
  | "asset_metadata_unavailable"
  | "storage_access_unavailable";

export type AgentAssetResolveOutcome =
  | { kind: "ok"; value: AgentAssetResolveResult }
  | { kind: "rejected"; reason: AgentAssetResolveRejection };

export interface AgentAssetResolverDeps {
  findAccessible(
    assetId: string,
    userId: string,
  ): Promise<AgentReadableAsset | null>;
  sign(
    storageKey: string,
    options?: { forModelReading?: boolean },
  ): Promise<{ url: string; expiresAt: Date }>;
}

export async function resolveAgentAsset(
  request: AgentAssetResolveRequest,
  owner: { userId: string; projectId: string },
  deps: AgentAssetResolverDeps,
): Promise<AgentAssetResolveOutcome> {
  const asset = await deps.findAccessible(request.asset_id, owner.userId);
  if (!asset) return { kind: "rejected", reason: "asset_inaccessible" };

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

  const isSvg = (asset.mime ?? "").toLowerCase().includes("svg");
  const forModelReading = asset.type === "image" && !isSvg;
  let signed: Awaited<ReturnType<AgentAssetResolverDeps["sign"]>>;
  let probeSigned: Awaited<ReturnType<AgentAssetResolverDeps["sign"]>>;
  try {
    signed = await deps.sign(asset.storage_key, { forModelReading });
    probeSigned = forModelReading
      ? await deps.sign(asset.storage_key, { forModelReading: false })
      : signed;
  } catch {
    return { kind: "rejected", reason: "storage_access_unavailable" };
  }

  const parsed = agentAssetResolveResultSchema.safeParse({
    asset_id: request.asset_id,
    media_type: asset.type,
    mime_type: forModelReading ? "image/jpeg" : asset.mime,
    size_bytes: Number(asset.size),
    duration_seconds: asset.duration_seconds,
    read_url: signed.url,
    probe_url: probeSigned.url,
    expires_at: signed.expiresAt.toISOString(),
  });
  if (!parsed.success) {
    return { kind: "rejected", reason: "storage_access_unavailable" };
  }
  return { kind: "ok", value: parsed.data };
}
