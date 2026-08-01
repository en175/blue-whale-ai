import {
  ASSET_UNAVAILABLE_CODE,
  RESOURCE_NOT_FOUND_CODE,
} from "@blue-whale/contracts";
import type { AssetRepo, ProjectRepo } from "@blue-whale/persistence";

import type { AssetReader } from "./ports";

/** GET /api/projects/{projectId}/assets/{assetId}/content：返回资产原始字节。
 *  对齐 Java ProjectAssetContentService.read → AssetContent(content, mime) → ResponseEntity<byte[]>。
 *  成功不走 {code,msg,data} 信封（直接返字节 + content-type），失败才返信封，故用判别联合。 */
export type ContentResult =
  | { ok: true; content: Uint8Array; mime: string }
  | { ok: false; code: number; msg: string };

export async function handleContentAsset(
  userId: string,
  projectId: string,
  assetId: string,
  deps: {
    project: ProjectRepo;
    assets: AssetRepo;
    reader: AssetReader | null;
  },
): Promise<ContentResult> {
  const project = await deps.project.findOwnedById(projectId, userId);
  if (!project)
    return { ok: false, code: RESOURCE_NOT_FOUND_CODE, msg: "资源不存在" };

  const asset = await deps.assets.findAccessible(projectId, assetId, userId);
  if (!asset)
    return { ok: false, code: RESOURCE_NOT_FOUND_CODE, msg: "资源不存在" };

  if (!asset.storage_key || asset.storage_key.trim() === "") {
    return { ok: false, code: ASSET_UNAVAILABLE_CODE, msg: "资源不可用" };
  }
  if (!deps.reader)
    return { ok: false, code: ASSET_UNAVAILABLE_CODE, msg: "资源不可用" };

  try {
    const content = await deps.reader.read(asset.storage_key);
    return {
      ok: true,
      content,
      mime:
        asset.mime && asset.mime.length > 0
          ? asset.mime
          : "application/octet-stream",
    };
  } catch {
    return { ok: false, code: ASSET_UNAVAILABLE_CODE, msg: "资源不可用" };
  }
}
