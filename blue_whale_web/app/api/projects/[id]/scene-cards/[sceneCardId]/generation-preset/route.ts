import { fail, ok, RESOURCE_NOT_FOUND_CODE } from "@blue-whale/contracts";

import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createSceneCardGenerationDeps } from "@/lib/conversation/deps";
import { wireInteger } from "@/lib/wire-integer";

// GET /api/projects/{id}/scene-cards/{sceneCardId}/generation-preset
// 编辑器只读端点：返回当前 Preset 完整参数 + SceneCard 版本与权威正文（完整参数不进 Snapshot）。
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string; sceneCardId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id, sceneCardId } = await ctx.params;
    const result =
      await createSceneCardGenerationDeps().getSceneCardGenerationPreset(
        id,
        sceneCardId,
        userId,
      );
    if (result.kind !== "found") {
      return Response.json(fail(RESOURCE_NOT_FOUND_CODE, "场景卡不存在"));
    }
    return Response.json(
      ok({
        scene_card: {
          scene_card_id: wireInteger(result.scene_card.scene_card_id),
          version: result.scene_card.version,
          title: result.scene_card.title,
          content_markdown: result.scene_card.content_markdown,
        },
        preset: {
          version: result.preset.version,
          parameters: result.preset.parameters,
          reference_mode: result.preset.reference_mode,
          reference_assets: result.preset.reference_assets,
          capability_snapshot_version:
            result.preset.capability_snapshot_version,
        },
        projection: result.projection,
      }),
    );
  });
}
