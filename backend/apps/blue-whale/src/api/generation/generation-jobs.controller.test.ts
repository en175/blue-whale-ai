import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DomainError,
  ERROR_INVALID_REFERENCE,
  ERROR_JOB_NOT_RETRYABLE_STATUS,
  errorCodeToNumeric,
  fail,
  httpStatusForCode,
  ok,
} from "@lib/contracts";

vi.mock("@lib/shared/generation/handle-cancel-generation-job.js", () => ({
  handleCancelGenerationJob: vi.fn(),
}));
vi.mock("@lib/shared/generation/handle-retry-generation-job.js", () => ({
  handleRetryGenerationJob: vi.fn(),
}));
vi.mock("@lib/shared/generation/handle-create-generation-job.js", () => ({
  handleCreateGenerationJob: vi.fn(),
}));
vi.mock("@lib/shared/generation/generation-queue.js", () => ({
  enqueueVideoGenerationJob: vi.fn(),
  enqueueImageGenerationJob: vi.fn(),
  enqueueAudioGenerationJob: vi.fn(),
}));
vi.mock("@lib/shared/billing/billing-client.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@lib/shared/billing/billing-client.js")
  >();
  return {
    ...actual,
    sharedBillingClient: () => ({
      charge: async () => ({ chargedCredits: 1, catalogVersion: 1, duplicated: false }),
      quote: async () => ({ credits: BigInt(1), catalogVersion: 1 }),
      queryBalance: async () => ({ availableCredits: 0, expiring: [] }),
      listTransactions: async () => ({ items: [], total: 0 }),
    }),
  };
});
vi.mock("@lib/infra/logging/blue-whale-logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { handleCancelGenerationJob } = await import(
  "@lib/shared/generation/handle-cancel-generation-job.js"
);
const { handleRetryGenerationJob } = await import(
  "@lib/shared/generation/handle-retry-generation-job.js"
);
const { handleCreateGenerationJob } = await import(
  "@lib/shared/generation/handle-create-generation-job.js"
);
const { enqueueVideoGenerationJob } = await import(
  "@lib/shared/generation/generation-queue.js"
);
const { logger } = await import("@lib/infra/logging/blue-whale-logger.js");
const { GenerationJobsController } = await import(
  "./generation-jobs.controller.js"
);

function makeController() {
  return new GenerationJobsController(
    {} as never,
    { repo: {} } as never,
    {} as never,
    {} as never,
    { materialStatusRepo: {} } as never,
    {} as never,
    {} as never,
  );
}

const USER = { userId: "9" } as never;
const INVALID_REFERENCE_CODE = errorCodeToNumeric(ERROR_INVALID_REFERENCE);
const NOT_RETRYABLE_STATUS_CODE = errorCodeToNumeric(ERROR_JOB_NOT_RETRYABLE_STATUS);

beforeEach(() => {
  vi.mocked(handleCancelGenerationJob).mockReset();
  vi.mocked(handleRetryGenerationJob).mockReset();
  vi.mocked(handleCreateGenerationJob).mockReset();
  vi.mocked(enqueueVideoGenerationJob).mockReset().mockResolvedValue(undefined);
  vi.mocked(logger.error).mockClear();
  vi.mocked(logger.warn).mockClear();
});

describe("GenerationJobsController.cancel 响应口径（IKIPWT）", () => {
  it("业务失败（1034 invalid_reference）→ 抛 DomainError，状态与码表一致，不再透传 fail 信封", async () => {
    const controller = makeController();
    vi.mocked(handleCancelGenerationJob).mockResolvedValue(
      fail(INVALID_REFERENCE_CODE, "参考素材不存在或无权访问") as never,
    );

    const rejection = controller.cancel(USER, "523", "77");
    await expect(rejection).rejects.toBeInstanceOf(DomainError);
    await expect(rejection).rejects.toMatchObject({
      code: INVALID_REFERENCE_CODE,
      status: httpStatusForCode(INVALID_REFERENCE_CODE),
      message: "参考素材不存在或无权访问",
    });
    expect(httpStatusForCode(INVALID_REFERENCE_CODE)).toBeGreaterThanOrEqual(400);
  });

  it("成功取消 → 原样返回 ok 信封，不抛", async () => {
    const controller = makeController();
    const envelope = ok({ generation_job_id: "77", status: "canceling" });
    vi.mocked(handleCancelGenerationJob).mockResolvedValue(envelope as never);

    await expect(controller.cancel(USER, "523", "77")).resolves.toBe(envelope);
  });
});

describe("GenerationJobsController.retry 响应口径（IKIPWT / IKIPWU）", () => {
  it("不可重试状态（1054 job_not_retryable_status）→ 抛 DomainError，不再透传 fail 信封成 HTTP 201", async () => {
    const controller = makeController();
    vi.mocked(handleRetryGenerationJob).mockResolvedValue(
      fail(NOT_RETRYABLE_STATUS_CODE, "当前状态不允许重试，仅失败或部分成功的任务可重试") as never,
    );

    const rejection = controller.retry(USER, "523", "77", {}, "idem-1", undefined);
    await expect(rejection).rejects.toBeInstanceOf(DomainError);
    await expect(rejection).rejects.toMatchObject({
      code: NOT_RETRYABLE_STATUS_CODE,
      status: httpStatusForCode(NOT_RETRYABLE_STATUS_CODE),
      message: "当前状态不允许重试，仅失败或部分成功的任务可重试",
    });
    expect(httpStatusForCode(NOT_RETRYABLE_STATUS_CODE)).toBeGreaterThanOrEqual(400);
    expect(enqueueVideoGenerationJob).not.toHaveBeenCalled();
  });

  it("成功重试（video）→ 原样返回 ok 信封并入队新 job，不抛", async () => {
    const controller = makeController();
    const envelope = ok({ generation_job_id: "80", type: "video" });
    vi.mocked(handleRetryGenerationJob).mockResolvedValue(envelope as never);

    await expect(
      controller.retry(USER, "523", "77", {}, "idem-2", undefined),
    ).resolves.toBe(envelope);
    expect(enqueueVideoGenerationJob).toHaveBeenCalledWith("80");
  });
});

describe("GenerationJobsController.create enqueue 日志分级（IKJ80Q）", () => {
  it("环境缺配（未配置 ROCKETMQ_ENDPOINTS）→ WARN 说明恢复扫描兜底，不打 ERROR，请求照常受理", async () => {
    const controller = makeController();
    const envelope = ok({ generation_job_id: "88" });
    vi.mocked(handleCreateGenerationJob).mockResolvedValue(envelope as never);
    vi.mocked(enqueueVideoGenerationJob).mockRejectedValueOnce(
      new Error(
        "未配置 ROCKETMQ_ENDPOINTS（测试环境 gRPC 端点，如 115.190.244.91:8081）",
      ),
    );

    await expect(
      controller.create(USER, "523", { type: "video" } as never, "idem-3", undefined),
    ).resolves.toBe(envelope);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("恢复扫描"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("jobId=88"));
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("真派发失败（其他错误）→ 保持 ERROR，请求仍不抛（回退路径语义不变）", async () => {
    const controller = makeController();
    const envelope = ok({ generation_job_id: "89" });
    vi.mocked(handleCreateGenerationJob).mockResolvedValue(envelope as never);
    vi.mocked(enqueueVideoGenerationJob).mockRejectedValueOnce(
      new Error("gRPC 通道断开"),
    );

    await expect(
      controller.create(USER, "523", { type: "video" } as never, "idem-4", undefined),
    ).resolves.toBe(envelope);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("enqueue video job failed"),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
