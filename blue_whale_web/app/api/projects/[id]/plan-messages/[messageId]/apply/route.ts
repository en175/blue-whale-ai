import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import {
  createCanvasDeps,
  createPlanApplicationDeps,
} from "@/lib/conversation/deps";
import { handleApplyPlanMessage } from "@/lib/conversation/handle-apply-plan-message";
import { placeSceneCardNode } from "@/lib/conversation/scene-card-placement";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; messageId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id, messageId } = await ctx.params;
    const result = await handleApplyPlanMessage(
      userId,
      id,
      messageId,
      request.headers.get("Idempotency-Key"),
      await request.text(),
      createPlanApplicationDeps(),
    );
    // AC#5：第一阶段成功后做最佳努力 Canvas 放置（可重试第二阶段，失败不回滚、不重试，交 T14）。
    if (result.code === 200 && result.data?.scene_card_id) {
      try {
        await placeSceneCardNode(
          createCanvasDeps(),
          id,
          String(result.data.scene_card_id),
        );
      } catch (error) {
        // 放置失败不阻塞应用成功；pending 节点交 T14 恢复。记录便于 T14 排查。
        console.warn(
          `[plan-application] scene_card ${result.data.scene_card_id} Canvas 放置失败：`,
          error,
        );
      }
    }
    return Response.json(result, {
      status: result.code === 200 ? 202 : 200,
    });
  });
}
