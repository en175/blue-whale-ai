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
    /**
     * 用户上传的那份字节，原样（IKE53N）。
     *
     * 与 `read_url` 的区别只有一个，但它是本字段存在的全部理由：`read_url` 对图片带
     * `x-tos-process` 降采样，`probe_url` 不带。探测要回答「这份文件到底是什么」，那个答案
     * 只能从用户的字节里读，读转码结果读到的是 TOS 的答案——文件好的时候恒等于 `jpeg`，
     * 文件坏的时候 TOS 直接回 400，一个字节也拿不到（实测 `This image format is not
     * supported`，测试站 2026-09-08）。
     *
     * 视频与存量 SVG 本来就不过图片处理，两条地址相同。
     */
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
  // 存量 SVG 绕开图片处理（新上传已在 upload.ts 挡掉）。
  //
  // TOS 对 SVG 做 `x-tos-process` 会挂死——实测 25 秒零字节。跳过之后它原样吐字节，
  // agent 的 `sniffSvg` 认得出 `<?xml`，媒体白名单据此给出 `asset_format_unsupported`
  // （**不可重试**，文案直说换格式），而不是干等一轮再报一句没用的「请重试」。
  const isSvg = (asset.mime ?? "").toLowerCase().includes("svg");
  const forModelReading = asset.type === "image" && !isSvg;
  let signed: Awaited<ReturnType<AgentAssetResolverDeps["sign"]>>;
  // 探测那一条（IKE53N）。降采样是**给模型的**，探测要的是用户上传的字节本身，所以图片要签
  // 两次：一次带处理参数给模型，一次不带给探测。两者都不过网络，签名是本地算的。
  //
  // 不这么做的代价不是理论上的：一份坏图 TOS 转不动、直接回 400，探测于是连一个字节都读不到，
  // 只能报「取字节失败，可以重试」，模型照着这句话又读一遍，再失败一次（测试站 2026-09-08，
  // 同一个 Run 里读了两次）。更安静的一半是文件没坏的时候——探测嗅到的永远是 TOS 转出来的
  // JPEG，于是 agent 那份「只看字节、不看别人说的」的探测承诺，对图片一直是空转的。
  let probeSigned: Awaited<ReturnType<AgentAssetResolverDeps["sign"]>>;
  try {
    signed = await deps.sign(asset.storage_key, { forModelReading });
    // 没有处理参数时两条地址本来就是同一条，不必多签一次。
    probeSigned = forModelReading
      ? await deps.sign(asset.storage_key, { forModelReading: false })
      : signed;
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
    probe_url: probeSigned.url,
    expires_at: signed.expiresAt.toISOString(),
  });
  if (!parsed.success) {
    return { kind: "rejected", reason: "storage_access_unavailable" };
  }
  return { kind: "ok", value: parsed.data };
}
