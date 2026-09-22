import { createHash } from "node:crypto";
import type {
  SaveSharedAssetRequest,
  SharedAssetKind,
  SharedAssetSnapshot,
  SharedAssetType,
} from "@lib/contracts";

/** 共享资产保存计划：策略校验 + 派生的一次性产出，Service 只负责落库与幂等兜底。 */
export interface SharedAssetSavePlan {
  name: string;
  thumbnailUrl: string | null;
  snapshot: SharedAssetSnapshot;
  dedupKey: string | null;
}

export interface SharedAssetSaveContext {
  userId: string;
}

/** 每种共享资产类型一种策略：校验（E6 / 源归属）与派生（名称/缩略图/快照/幂等键）内聚在策略内。
 *  两层类型对齐画布：assetType = 节点大类，kind = 节点判别字段（goods/scene/text 为 null）。
 *  新增类型 = 新增一个策略并注册，Service/Repo/Controller 零改动。 */
export interface SharedAssetTypeStrategy {
  readonly assetType: SharedAssetType;
  readonly kind: SharedAssetKind | null;
  buildSavePlan(
    ctx: SharedAssetSaveContext,
    input: SaveSharedAssetRequest,
  ): Promise<SharedAssetSavePlan>;
}

/** NestJS 多注入 token：全部类型策略。 */
export const SHARED_ASSET_TYPE_STRATEGY = "SHARED_ASSET_TYPE_STRATEGY";
/** 来源（assets/scene_cards）只读访问端口 token。 */
export const SHARED_ASSET_SOURCE_PORT = "SHARED_ASSET_SOURCE_PORT";

/** 从判别联合请求中提取快照（卡片/商品/文本前端直传；媒体/场景由后端抓取 → null）。 */
export function sharedAssetSnapshotOf(
  input: SaveSharedAssetRequest,
): SharedAssetSnapshot | null {
  switch (input.assetType) {
    case "card":
    case "goods":
    case "text":
      return input.snapshot;
    default:
      return null;
  }
}

/** 从判别联合请求中提取第二层 kind（card/media 有，goods/scene/text 无）。 */
export function sharedAssetKindOf(
  input: SaveSharedAssetRequest,
): SharedAssetKind | null {
  switch (input.assetType) {
    case "card":
    case "media":
      return input.kind;
    default:
      return null;
  }
}

/** 从判别联合请求中提取源素材 id（media 有，其余无）。 */
export function sharedAssetSourceAssetIdOf(
  input: SaveSharedAssetRequest,
): string | null {
  return input.assetType === "media" ? input.sourceAssetId : null;
}

/** 从判别联合请求中提取源场景卡 id（scene 有，其余无）。 */
export function sharedAssetSourceSceneCardIdOf(
  input: SaveSharedAssetRequest,
): string | null {
  return input.assetType === "scene" ? input.sourceSceneCardId : null;
}

/** 从判别联合请求中提取 name（media 可选 name，其余无）。 */
export function sharedAssetRequestNameOf(
  input: SaveSharedAssetRequest,
): string | undefined {
  return input.assetType === "media" ? input.name : undefined;
}

/** sha256 十六进制摘要（去重键）。 */
export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** 按字符截断到 max 上限（对齐 VarChar(255) 字符语义）。
 *  用 Array.from 按码点切分，避免切裂代理对（emoji）导致 utf8mb4 入库失败。 */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

/** URL 截断到列宽上限（对齐 VarChar(512)，防溢出 500；超长 URL 本就不该入库）。 */
export function truncateUrl(url: string, max: number): string {
  return url.length <= max ? url : url.slice(0, max);
}

/** 富文本去标签取纯文本（文本共享资产名称派生）。 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}
