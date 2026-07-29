import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { sealGenerationCredential } from "@blue-whale/core";
import {
  createGenerationCommandDeps,
  createGenerationWorkerDeps,
} from "@/lib/generation/deps";
import { handleCreateGenerationJob } from "@/lib/generation/handle-create-generation-job";
import { processJob } from "@/lib/generation/worker/generation-worker";
import { enqueueVideoGenerationJob } from "@/lib/generation/video-queue";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";
const GENERATION_CREDENTIAL_SECRET =
  process.env.GENERATION_CREDENTIAL_SECRET ?? JWT_SECRET;

// POST /api/projects/{id}/generation-jobs  body: {type, input_asset_ids, parameters, expected_output_count}
// 创建任务后立即返回；图片暂由 Next 异步执行，视频投递 BullMQ 后由独立 Worker 执行。
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId)
    return Response.json({
      code: 401,
      msg: "未登录或 token 已过期",
      data: null,
    });
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
  const providerCredential =
    body.type === "video" && newApiToken?.startsWith("sk-")
      ? sealGenerationCredential(newApiToken, GENERATION_CREDENTIAL_SECRET)
      : undefined;
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
    const worker = createGenerationWorkerDeps(newApiToken);
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
}
