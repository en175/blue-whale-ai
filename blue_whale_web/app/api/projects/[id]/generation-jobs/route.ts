import {
  GenerationCredentialConfigurationError,
  loadGenerationCredentialSecret,
  sealGenerationCredential,
} from "@blue-whale/core";

import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import {
  createGenerationCommandDeps,
  createGenerationWorkerDeps,
} from "@/lib/generation/deps";
import { handleCreateGenerationJob } from "@/lib/generation/handle-create-generation-job";
import { processJob } from "@/lib/generation/worker/generation-worker";
import { enqueueVideoGenerationJob } from "@/lib/generation/video-queue";

// POST /api/projects/{id}/generation-jobs  body: {type, input_asset_ids, parameters, expected_output_count}
// 创建任务后立即返回；图片暂由 Next 异步执行，视频投递 BullMQ 后由独立 Worker 执行。
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id } = await ctx.params;
    const idempotencyKey = request.headers.get("Idempotency-Key");
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const authHeader = request.headers.get("authorization");
    const newApiToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : undefined;
    let providerCredential: string | undefined;
    if (
      (body.type === "video" || body.type === "image") &&
      newApiToken?.startsWith("sk-")
    ) {
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
    const result = await handleCreateGenerationJob(
      userId,
      id,
      body,
      idempotencyKey,
      createGenerationCommandDeps(),
      providerCredential ? { providerCredential } : {},
    );

    // 图片暂保留请求内调度；视频进入 BullMQ，由独立 Node Worker 执行短步骤。
    if (result.code === 200 && result.data && body.type === "video") {
      try {
        await enqueueVideoGenerationJob(String(result.data.generation_job_id));
      } catch (error) {
        // DB Job 是事实源；Redis 故障时由 Worker 的低频恢复扫描补入队。
        console.error(
          "[generation] enqueue video job failed:",
          error instanceof Error ? error.message : "unknown",
        );
      }
    } else if (result.code === 200 && result.data) {
      // 图片：请求内立即调度一次（低延迟）；token 从 job 密封凭证解出，不依赖请求闭包。
      // 进程重启导致的孤儿 queued 任务 + 瞬时失败重试，由 instrumentation.ts 的恢复扫描兜底。
      const worker = createGenerationWorkerDeps();
      void processJob({
        ...worker,
        workerId: `next-${Date.now()}`,
        jobId: result.data.generation_job_id,
        userId,
      }).catch((e) =>
        console.error(
          "[generation] async worker failed:",
          e instanceof Error ? e.message : e,
        ),
      );
    }
    return Response.json(result);
  });
}
