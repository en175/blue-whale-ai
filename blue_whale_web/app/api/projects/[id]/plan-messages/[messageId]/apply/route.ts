import {
  createNewApiClient,
  GenerationCredentialConfigurationError,
  loadGenerationCredentialSecret,
  sealGenerationCredential,
} from "@blue-whale/core";
import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import {
  createCanvasDeps,
  createPlanApplicationDeps,
} from "@/lib/conversation/deps";
import { handleApplyPlanMessage } from "@/lib/conversation/handle-apply-plan-message";
import { placeSceneCardNode } from "@/lib/conversation/scene-card-placement";
import { createGenerationWorkerDeps } from "@/lib/generation/deps";
import { processJob } from "@/lib/generation/worker/generation-worker";

// POST /api/projects/{id}/plan-messages/{messageId}/apply
// 手动应用 PlanMessage（媒体感知）：scene_card_create 建场景卡+首视频 job（T11）；
// image_generate 建首图 job（T10，需 Authorization: Bearer <sk-token> 做额度预检与凭证密封）。
// 两者均要求 Idempotency-Key；成功返回 202。
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; messageId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id, messageId } = await ctx.params;
    const idempotencyKey = request.headers.get("Idempotency-Key");
    const body = await request.text();
    const authHeader = request.headers.get("authorization");
    const newApiToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : undefined;

    let providerCredential: string | undefined;
    let quotaCheck: (() => Promise<{ sufficient: boolean }>) | undefined;
    if (newApiToken?.startsWith("sk-")) {
      try {
        providerCredential = sealGenerationCredential(
          newApiToken,
          loadGenerationCredentialSecret(),
        );
      } catch (error) {
        if (error instanceof GenerationCredentialConfigurationError) {
          return Response.json(
            { code: 503, msg: "生成服务暂不可用", data: null },
            { status: 503 },
          );
        }
        throw error;
      }
      const client = createNewApiClient({
        baseUrl: process.env.NEW_API_BASE_URL ?? "",
      });
      const token = newApiToken;
      quotaCheck = async () => {
        const usage = await client.getTokenUsage(token);
        return { sufficient: usage.userQuota > 0 };
      };
    }

    const result = await handleApplyPlanMessage(
      userId,
      id,
      messageId,
      idempotencyKey,
      body,
      createPlanApplicationDeps(),
      providerCredential ? { providerCredential, quotaCheck } : {},
    );

    if (result.code === 200 && result.data) {
      const data = result.data as {
        scene_card_id?: unknown;
        first_generation_job_id?: unknown;
      };
      // 视频分支（T11）：第一阶段成功后最佳努力 Canvas 放置（失败不回滚，pending 交 T14）。
      const sceneCardId = data.scene_card_id;
      if (sceneCardId !== undefined && sceneCardId !== null) {
        try {
          await placeSceneCardNode(createCanvasDeps(), id, String(sceneCardId));
        } catch (error) {
          console.warn(
            `[plan-application] scene_card ${sceneCardId} Canvas 放置失败：`,
            error,
          );
        }
      }
      // 图片分支（T10）：成功后即时调度首图 job（低延迟；孤儿由 instrumentation 恢复扫描兜底）。
      const jobId = data.first_generation_job_id;
      if (typeof jobId === "string") {
        const worker = createGenerationWorkerDeps();
        void processJob({
          ...worker,
          workerId: `next-${Date.now()}`,
          jobId,
          userId,
        }).catch((e) =>
          console.error(
            "[plan-apply] async worker failed:",
            e instanceof Error ? e.message : e,
          ),
        );
      }
    }

    return Response.json(result, {
      status: result.code === 200 ? 202 : 200,
    });
  });
}
