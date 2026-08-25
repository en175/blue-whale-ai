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
    options?: { forModelReading?: boolean },
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

  // 图片签成给模型读的降采样版本（IKAZC2）。
  //
  // 本端点解析出来的 `read_url` 只有一个消费方——agent 的 production-asset-analyzer，它把
  // URL 交给 AI SDK。SDK 在 provider 未声明支持该 URL 时会自己下载、base64 内联，于是一张
  // 8.27MB 的 PNG 变成约 11MB 请求体，被链路上任意一道 body 上限挡下，用户看到的是「读不到图」。
  //
  // 抬高那些上限只是把墙往后挪，下一张更大的图照样撞。降采样是从源头不再需要撞。
  //
  // 视频不动：TOS 的图片处理不适用，且视频走的是另一条理解链路。
  const forModelReading = asset.type === "image";
  let signed: Awaited<ReturnType<AgentAssetResolverDeps["sign"]>>;
  try {
    signed = await deps.sign(asset.storage_key, { forModelReading });
  } catch {
    return { kind: "rejected", reason: "storage_access_unavailable" };
  }

  const parsed = agentAssetResolveResultSchema.safeParse({
    asset_id: request.asset_id,
    media_type: asset.type,
    // 降采样时一并转成了 JPEG，所以这里报的必须是转码后的类型。仍报 `image/png` 会让下游
    // 按错误的类型处理——`mime_type` 是随 `read_url` 一起交出去的，两者说的得是同一份字节。
    mime_type: forModelReading ? "image/jpeg" : asset.mime,
    // 仍报原图大小：媒体策略用它守「这张素材是否荒唐」（图片上限 10MB，vendor_doc 依据），
    // 那是关于素材的判断，不是关于本次传输量的。换成降采样后的字节会让这道闸失去意义。
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
