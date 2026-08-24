import { z } from "zod";

const decimalIdSchema = z.string().regex(/^[1-9][0-9]*$/);

/**
 * Asset resolve 请求。
 *
 * 内容版本校验已整体撤除（IKASSI）：蓝鲸素材不可变——换一张图就是一个新的 `asset_id`，没有
 * 任何路径改写已有素材的字节，所以这道校验拦不住它设计要拦的事；而它的指纹一旦因元数据回填而
 * 改变，全部历史授权会一起变成「资源不存在」。归属是唯一的门。
 *
 * schema 是 `.strict()` 的，而 `asset_version` 已从这里删除：Agent 侧同一轮迭代里已停止发送
 * （IKASSI 第三步），且入站 `asset_ref` 此前从无生产者，这个端点在这条路径上没有线上流量，
 * 因此不需要再留一个只会掩盖版本不一致的兼容字段。
 */
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
