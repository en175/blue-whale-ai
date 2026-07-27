import {
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  ok,
} from "@blue-whale/contracts";
import type { AssetRepo, ProjectRepo } from "@blue-whale/persistence";

/** POST /api/projects/{projectId}/assets：跨项目复制资产（「添加到项目」）。
 *  对齐 Java AssetCopyService.copyToProject：
 *  - Idempotency-Key 必传（缺失 → 100000）；
 *  - 目标项目须归属当前用户（部署表 project 无 purpose 列，跳过 Java 的 PURPOSE_CANVAS 校验）；
 *  - 源资产须归属当前用户且 status=normal，否则统一 100301（不泄漏存在性）；
 *  - 副本行与源共享 storage_key 物理对象，行级独立。
 *
 *  ⚠️ 部署 blue_whale 库无 command_idempotency 表（只加不改），故未实现跨请求重放去重 ——
 *  同键同源重放会再插一行副本。上线若需严格幂等，需先建该表（见 ADR-0016/0017）。 */
export async function handleCopyAsset(
  userId: string,
  projectId: string,
  body: { source_asset_id?: unknown },
  idempotencyKey: string | null | undefined,
  deps: { project: ProjectRepo; assets: AssetRepo },
) {
  if (!idempotencyKey || idempotencyKey.trim() === "") {
    return fail(PARAM_MISSING_CODE, "缺少 Idempotency-Key");
  }
  const sourceAssetId =
    typeof body.source_asset_id === "number" || typeof body.source_asset_id === "string"
      ? String(body.source_asset_id)
      : "";
  if (!sourceAssetId) {
    return fail(PARAM_MISSING_CODE, "缺少 source_asset_id");
  }

  const project = await deps.project.findOwnedById(projectId, userId);
  if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

  const source = await deps.assets.findOwnedSource(sourceAssetId, userId);
  if (!source) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

  const copy = await deps.assets.insertCopy(projectId, userId, source);
  return ok(copy);
}
