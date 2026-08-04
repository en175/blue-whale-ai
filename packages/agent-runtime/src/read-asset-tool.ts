import {
  assetContextProjectionSchema,
  type AssetContextProjection,
  type MentionInputSnapshot,
} from "@blue-whale/contracts";
import { buildTosPresignedGetUrl } from "@blue-whale/core";
import { z } from "zod";

const decimalIdSchema = z.string().regex(/^[1-9][0-9]*$/);

/** read_asset 入参：只接受 mention identity（AC#3/#4）。
 *  模型不得提供 asset_id、对象存储路径、URL 或跨 Project 身份——这些一律不在
 *  本轮 mention_input_snapshot 的 mention_id 集合内，将被拒绝。 */
export const readAssetToolInputSchema = z
  .object({ mention_id: decimalIdSchema })
  .strict();

export type ReadAssetToolInput = z.infer<typeof readAssetToolInputSchema>;

/** read_asset 成功出参：受限产品投影 + 临时签名访问能力。 */
export const readAssetToolResultSchema = z
  .object({
    projection: assetContextProjectionSchema,
    presigned_url: z.string().url(),
    expires_at: z.string().min(1),
  })
  .strict();

export type ReadAssetToolResult = z.infer<typeof readAssetToolResultSchema>;

export type ReadAssetRejectionReason =
  | "mention_not_in_snapshot"
  | "mention_not_asset"
  | "mention_unavailable"
  | "asset_target_unresolved"
  | "asset_inaccessible"
  | "storage_key_missing"
  | "storage_access_unconfigured";

export type ReadAssetToolOutcome =
  | ({ kind: "ok" } & ReadAssetToolResult)
  | { kind: "rejected"; reason: ReadAssetRejectionReason };

/** TOS 预签名配置（对齐 generation-runtime 的 GenerationTosConfig 来源：
 *  VOLC_ACCESS_KEY_ID / VOLC_SECRET_ACCESS_KEY / VOLC_TOS_ENDPOINT /
 *  VOLC_TOS_BUCKET / VOLC_TOS_REGION）。 */
export interface ReadAssetTosConfig {
  endpoint: string;
  bucket: string;
  region: string;
  ak: string;
  sk: string;
  signedUrlTtlSeconds?: number;
}

/** 实时复核端口：mention_id → 内部 target asset id（不暴露给模型），
 *  与 asset-repo.findAccessible(id+project+user+normal+!delete)。 */
export interface ReadAssetToolContext {
  projectId: string;
  userId: string;
  resolveAssetTargetId(mentionId: string): Promise<string | null>;
  findAccessible(
    projectId: string,
    assetId: string,
    userId: string,
  ): Promise<{ storage_key: string | null; mime: string | null } | null>;
  tosConfig: ReadAssetTosConfig | null;
  /** 签名时刻（测试注入固定值）。 */
  now?: Date;
}

/** read_asset 工具定义（注册到 TOOL_REGISTRY，version 1）。 */
export const READ_ASSET_TOOL = {
  tool_id: "read_asset",
  registry_version: 1,
  inputSchema: readAssetToolInputSchema,
  outputSchema: readAssetToolResultSchema,
} as const;

/**
 * 执行 read_asset：按 mention identity 读取受限资产投影 + 临时签名访问。
 *
 * 授权链（AC#3/#4/#5）：
 * 1. mention_id 必须在本轮 mention_input_snapshot 内（拒绝集合外身份）。
 * 2. 该 mention 必须是 asset 类型且当前可读（available/stale）。
 * 3. mention_id → target asset id（内部解析）→ findAccessible 实时复核
 *    （status:normal + 归属 + 未删）；不命中即拒绝（权限可能在冻结后被撤回）。
 * 4. storage_key + TOS 配置就位 → 构造短期签名 GET URL；投影不含 storage_key/url/user_id。
 *
 * T08 只交付 handler 与授权链（可单元测）；模型主动调工具的循环接线尚未立工单。
 */
export async function executeReadAssetTool(
  input: ReadAssetToolInput,
  snapshot: MentionInputSnapshot,
  ctx: ReadAssetToolContext,
): Promise<ReadAssetToolOutcome> {
  const entry = snapshot.entries.find(
    (item) => item.mention_id === input.mention_id,
  );
  if (!entry) return { kind: "rejected", reason: "mention_not_in_snapshot" };
  if (entry.type !== "asset") return { kind: "rejected", reason: "mention_not_asset" };
  if (entry.availability === "unavailable") {
    return { kind: "rejected", reason: "mention_unavailable" };
  }
  const projectionParse = assetContextProjectionSchema.safeParse(
    entry.projection,
  );
  if (!projectionParse.success) {
    return { kind: "rejected", reason: "mention_unavailable" };
  }
  const projection: AssetContextProjection = projectionParse.data;

  const targetId = await ctx.resolveAssetTargetId(input.mention_id);
  if (!targetId) return { kind: "rejected", reason: "asset_target_unresolved" };
  const accessible = await ctx.findAccessible(
    ctx.projectId,
    targetId,
    ctx.userId,
  );
  if (!accessible) return { kind: "rejected", reason: "asset_inaccessible" };
  if (!accessible.storage_key) {
    return { kind: "rejected", reason: "storage_key_missing" };
  }
  if (!ctx.tosConfig) {
    return { kind: "rejected", reason: "storage_access_unconfigured" };
  }
  const ttl = ctx.tosConfig.signedUrlTtlSeconds ?? 600;
  const presigned = buildTosPresignedGetUrl({
    endpoint: ctx.tosConfig.endpoint,
    bucket: ctx.tosConfig.bucket,
    region: ctx.tosConfig.region,
    ak: ctx.tosConfig.ak,
    sk: ctx.tosConfig.sk,
    key: accessible.storage_key,
    expiresInSeconds: ttl,
    ...(ctx.now ? { now: ctx.now } : {}),
  });
  return {
    kind: "ok",
    projection,
    presigned_url: presigned.url,
    expires_at: presigned.expiresAt.toISOString(),
  };
}
