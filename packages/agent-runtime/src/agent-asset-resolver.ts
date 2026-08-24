import { z } from "zod";

const decimalIdSchema = z.string().regex(/^[1-9][0-9]*$/);

/**
 * Asset resolve 请求。
 *
 * `asset_version` 是**过渡期兼容字段：接受但完全忽略**（IKASSI 第二步）。内容版本校验已撤除
 * ——蓝鲸素材不可变，换一张图就是一个新的 `asset_id`，没有任何路径改写已有素材的字节，所以
 * 这道校验拦不住它设计要拦的事；而它的指纹一旦因元数据回填而改变，全部历史授权会一起变成
 * 「资源不存在」。
 *
 * 之所以保留而不是直接删掉：schema 是 `.strict()` 的，旧版 Agent 仍在发送这个字段，删掉会让
 * 它们全部 400。等 Agent 侧停止发送并稳定后，再单独提一次把它删干净。
 */
export const agentAssetResolveRequestSchema = z
  .object({
    asset_id: decimalIdSchema,
    asset_version: z.string().min(1).max(191).optional(),
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
    projectId: string,
    assetId: string,
    userId: string,
  ): Promise<AgentReadableAsset | null>;
  sign(
    storageKey: string,
  ): Promise<{ url: string; expiresAt: Date }>;
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
