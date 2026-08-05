import {
  GenerationCredentialConfigurationError,
  loadGenerationCredentialSecret,
  sealGenerationCredential,
} from "@blue-whale/core";

import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createSceneCardGenerationDeps } from "@/lib/conversation/deps";
import { handleSceneCardGenerate } from "@/lib/conversation/handle-scene-card-generate";
import { enqueueVideoGenerationJob } from "@/lib/generation/video-queue";

// POST /api/projects/{id}/scene-cards/{sceneCardId}/generate
// 已有 SceneCard 在编辑器中调整参数后点"生成"：原子更新 Preset(version+1) + 新 Record + 新 Job，
// 随后投递视频 BullMQ。DB Job 是事实源；Redis 故障由 Worker 恢复扫描补入队。
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; sceneCardId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id, sceneCardId } = await ctx.params;
    const body = await request.text();
    // 与 Dock 生成链路一致：请求方 sk token 密封进任务，worker 解密后调网关。
    const authHeader = request.headers.get("authorization");
    const newApiToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : undefined;
    let providerCredential: string | undefined;
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
    }
    const result = await handleSceneCardGenerate(
      userId,
      id,
      sceneCardId,
      request.headers.get("Idempotency-Key"),
      body,
      createSceneCardGenerationDeps(),
      providerCredential,
    );
    if (result.code === 200 && result.data?.generation_job_id != null) {
      try {
        await enqueueVideoGenerationJob(String(result.data.generation_job_id));
      } catch (error) {
        console.error(
          "[scene-card-generate] enqueue video job failed:",
          error instanceof Error ? error.message : "unknown",
        );
      }
    }
    return Response.json(result, {
      status: result.code === 200 ? 202 : 200,
    });
  });
}
