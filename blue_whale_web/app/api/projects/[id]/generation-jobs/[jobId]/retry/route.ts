import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import {
  createGenerationCommandDeps,
  createGenerationWorkerDeps,
} from "@/lib/generation/deps";
import { handleRetryGenerationJob } from "@/lib/generation/handle-retry-generation-job";
import { processJob } from "@/lib/generation/worker/generation-worker";
import { enqueueVideoGenerationJob } from "@/lib/generation/video-queue";

// POST /api/projects/{id}/generation-jobs/{jobId}/retry
// IK50GB 断链：统一认证（withAuthenticatedUser），无 JWT_SECRET。
// 仅终态 failed/partially_succeeded 的 job 可重试（handler/retryJob 内置校验）；
// 复制入参建新 queued job 后，按 type 重新入队（与 create 一致）：视频投 BullMQ、图片请求内 processJob。
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; jobId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id, jobId } = await ctx.params;
    const idempotencyKey = request.headers.get("Idempotency-Key") ?? "";
    const result = await handleRetryGenerationJob(
      userId,
      id,
      jobId,
      idempotencyKey,
      createGenerationCommandDeps(),
    );

    if (result.code === 200 && result.data) {
      const newJobId = String(result.data.generation_job_id);
      const authHeader = request.headers.get("authorization");
      const newApiToken = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : undefined;
      if (result.data.type === "video") {
        try {
          await enqueueVideoGenerationJob(newJobId);
        } catch (error) {
          // DB Job 是事实源；Redis 故障时由 Worker 低频恢复扫描补入队。
          console.error(
            "[generation] enqueue retry video job failed:",
            error instanceof Error ? error.message : "unknown",
          );
        }
      } else {
        const worker = createGenerationWorkerDeps(newApiToken);
        void processJob({
          ...worker,
          workerId: `next-retry-${Date.now()}`,
          jobId: result.data.generation_job_id,
          userId,
        }).catch((e) =>
          console.error(
            "[generation] async retry worker failed:",
            e instanceof Error ? e.message : e,
          ),
        );
      }
    }
    return Response.json(result);
  });
}
