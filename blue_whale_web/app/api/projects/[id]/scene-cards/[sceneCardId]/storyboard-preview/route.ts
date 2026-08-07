import {
  createNewApiClient,
  GenerationCredentialConfigurationError,
  loadGenerationCredentialSecret,
  sealGenerationCredential,
} from "@blue-whale/core";
import { fail, ok, RESOURCE_NOT_FOUND_CODE } from "@blue-whale/contracts";

import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createStoryboardPreviewDeps } from "@/lib/conversation/deps";
import { handleStoryboardPreviewCreate } from "@/lib/conversation/handle-storyboard-preview-create";
import { createGenerationWorkerDeps } from "@/lib/generation/deps";
import { processJob } from "@/lib/generation/worker/generation-worker";
import { wireInteger } from "@/lib/wire-integer";

// POST /api/projects/{id}/scene-cards/{sceneCardId}/storyboard-preview
// User 从 SceneCard 显式触发分镜预览（CONTEXT L43-47，可选旁路）：建 type=image 的 GenerationJob，
// 其 N 个 output_slot 即有序画格。不创建视频 job、不改 Preset、不切媒体类型。
// 与 Dock 图片链路一致：Authorization: Bearer <sk-token> 做额度预检与凭证密封；成功返回 202。
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; sceneCardId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id, sceneCardId } = await ctx.params;
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

    const result = await handleStoryboardPreviewCreate(
      userId,
      id,
      sceneCardId,
      request.headers.get("Idempotency-Key"),
      body,
      createStoryboardPreviewDeps(),
      providerCredential ? { providerCredential, quotaCheck } : {},
    );

    // 成功后即时调度首图 job（低延迟；孤儿由 instrumentation 恢复扫描兜底）。
    if (result.code === 200 && result.data?.generation_job_id != null) {
      const worker = createGenerationWorkerDeps();
      void processJob({
        ...worker,
        workerId: `next-${Date.now()}`,
        jobId: String(result.data.generation_job_id),
        userId,
      }).catch((e) =>
        console.error(
          "[storyboard-preview] async worker failed:",
          e instanceof Error ? e.message : e,
        ),
      );
    }

    return Response.json(result, {
      status: result.code === 200 ? 202 : 200,
    });
  });
}

// GET /api/projects/{id}/scene-cards/{sceneCardId}/storyboard-preview
// 只读端点：返回该 SceneCard 下所有未删除分镜预览（按 id 升序）。画格经 first_generation_job_id
// 关联 GenerationJob 取；编辑器据此把画格作为首/尾帧/参考图候选。
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string; sceneCardId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id, sceneCardId } = await ctx.params;
    const result = await createStoryboardPreviewDeps().listStoryboardPreviews(
      id,
      sceneCardId,
      userId,
    );
    if (result.kind !== "found") {
      return Response.json(fail(RESOURCE_NOT_FOUND_CODE, "资源不存在"));
    }
    return Response.json(
      ok({
        previews: result.previews.map((preview) => ({
          preview_id: wireInteger(preview.preview_id),
          scene_card_id: wireInteger(preview.scene_card_id),
          first_generation_job_id: wireInteger(preview.first_generation_job_id),
          summary_status: preview.summary_status,
        })),
      }),
    );
  });
}
