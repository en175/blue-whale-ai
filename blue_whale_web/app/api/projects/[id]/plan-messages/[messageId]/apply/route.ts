import {
  createNewApiClient,
  GenerationCredentialConfigurationError,
  loadGenerationCredentialSecret,
  sealGenerationCredential,
} from "@blue-whale/core";
import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createPlanApplicationDeps } from "@/lib/conversation/deps";
import { handleApplyPlanMessage } from "@/lib/conversation/handle-apply-plan-message";
import { createGenerationWorkerDeps } from "@/lib/generation/deps";
import { processJob } from "@/lib/generation/worker/generation-worker";

// POST /api/projects/{id}/plan-messages/{messageId}/apply
// 手动应用 image_generate 计划卡：原子接纳回执 + 首个图片 GenerationJob（不建 SceneCard）。
// 成功返回 202；Idempotency-Key + Authorization: Bearer <sk-token> 必带。
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; messageId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id, messageId } = await ctx.params;
    const idempotencyKey = request.headers.get("Idempotency-Key");
    const authHeader = request.headers.get("authorization");
    const newApiToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : undefined;

    let providerCredential: string | undefined;
    let quotaCheck = async () => ({ sufficient: true });
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

    const deps = createPlanApplicationDeps({ quotaCheck });
    const result = await handleApplyPlanMessage(
      userId,
      id,
      messageId,
      idempotencyKey,
      deps,
      providerCredential ? { providerCredential } : {},
    );

    // 成功后即时调度首图 job（低延迟，镜像 generation-jobs route 的请求内调度）；
    // 进程重启导致的孤儿 + 瞬时失败重试，由 instrumentation.ts 恢复扫描兜底。
    const jobId = result.data?.first_generation_job_id;
    if (result.code === 200 && typeof jobId === "string") {
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

    return Response.json(result, {
      status: result.code === 200 ? 202 : 200,
    });
  });
}
