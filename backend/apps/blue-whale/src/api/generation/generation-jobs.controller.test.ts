// IKIPWT：generation-jobs cancel/retry 两个 POST 入口的 controller 单测——业务失败
// `result.code !== 200 → throw DomainError` 改投统一投影后，「失败不透传信封、成功原样返回」
// 成了本文件的职责。台架抄 scene-card-generate.controller.test.ts：直接 new Controller，
// handler 与入队边界 vi.mock 掉，不挂 Nest、不连库、不碰 MQ。
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
vi.mock("@lib/shared/generation/generation-queue.js", () => ({
  enqueueVideoGenerationJob: vi.fn(),
  enqueueImageGenerationJob: vi.fn(),
  enqueueAudioGenerationJob: vi.fn(),
}));
vi.mock("@lib/infra/logging/blue-whale-logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { handleCancelGenerationJob } = await import(
  "@lib/shared/generation/handle-cancel-generation-job.js"
);
const { handleRetryGenerationJob } = await import(
  "@lib/shared/generation/handle-retry-generation-job.js"
);
const { enqueueVideoGenerationJob } = await import(
  "@lib/shared/generation/generation-queue.js"
);
const { GenerationJobsController } = await import(
  "./generation-jobs.controller.js"
);

function makeController() {
  return new GenerationJobsController(
    {} as never, // project：handler 已 mock，不触达
    { repo: {} } as never, // command：同上（retry audio 入队失败兜底才会用 markFailed）
    {} as never, // models
    {} as never, // cost
    {} as never, // canvas
    { materialStatusRepo: {} } as never, // material：门只接线不判定
    {} as never, // assets
  );
}

const USER = { userId: "9" } as never;
const INVALID_REFERENCE_CODE = errorCodeToNumeric(ERROR_INVALID_REFERENCE); // 1034
const NOT_RETRYABLE_STATUS_CODE = errorCodeToNumeric(ERROR_JOB_NOT_RETRYABLE_STATUS); // 1054（IKIPWU）

beforeEach(() => {
  vi.mocked(handleCancelGenerationJob).mockReset();
  vi.mocked(handleRetryGenerationJob).mockReset();
  vi.mocked(enqueueVideoGenerationJob).mockReset().mockResolvedValue(undefined);
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

// DomainError 本身不写响应：投影由 AllExceptionsFilter 负责（唯一投影出入口），
// 拒绝用例 rejects DomainError 即是「控制器把失败交出去」的断言。
