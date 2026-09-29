// IKIQGQ：场景卡再生成 / 分镜预览两个 POST 入口的 controller 单测——业务拒绝改抛
// DomainError 走统一投影后，「拒绝不写 200 信封、成功仍写 202」成了本文件的职责。
// 台架抄 canvases.controller.test.ts：直接 new Controller + 假 Response 捕获实际写出，
// handler 与入队边界 vi.mock 掉，不挂 Nest、不连库、不碰 MQ（先例：video-scene-splits.controller.test.ts）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import {
  DomainError,
  ERROR_INVALID_REFERENCE,
  PLAN_APPLICATION_QUOTA_INSUFFICIENT_CODE,
  RESOURCE_NOT_FOUND_CODE,
  errorCodeToNumeric,
  fail,
  httpStatusForCode,
  ok,
} from "@lib/contracts";

vi.mock("@lib/shared/generation/handle-scene-card-generate.js", () => ({
  handleSceneCardGenerate: vi.fn(),
}));
vi.mock("@lib/shared/generation/handle-storyboard-preview-create.js", () => ({
  handleStoryboardPreviewCreate: vi.fn(),
}));
vi.mock("@lib/shared/generation/generation-queue.js", () => ({
  enqueueVideoGenerationJob: vi.fn(),
  enqueueImageGenerationJob: vi.fn(),
  enqueueAudioGenerationJob: vi.fn(),
}));
vi.mock("@lib/infra/logging/blue-whale-logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { handleSceneCardGenerate } = await import(
  "@lib/shared/generation/handle-scene-card-generate.js"
);
const { handleStoryboardPreviewCreate } = await import(
  "@lib/shared/generation/handle-storyboard-preview-create.js"
);
const { enqueueVideoGenerationJob, enqueueImageGenerationJob } = await import(
  "@lib/shared/generation/generation-queue.js"
);
const { logger } = await import("@lib/infra/logging/blue-whale-logger.js");
const { SceneCardGenerateController } = await import(
  "./scene-card-generate.controller.js"
);

function makeController() {
  const controller = new SceneCardGenerateController(
    { repo: {} } as never, // sceneCard：handler 已 mock，repo 不触达
    { repo: {} } as never, // storyboard：同上
    { materialStatusRepo: {} } as never, // material：门只接线不判定
    {} as never, // assets
  );
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
  return { controller, res };
}

const USER = { userId: "9" } as never;
const INVALID_REFERENCE_CODE = errorCodeToNumeric(ERROR_INVALID_REFERENCE); // 1034

beforeEach(() => {
  vi.mocked(handleSceneCardGenerate).mockReset();
  vi.mocked(handleStoryboardPreviewCreate).mockReset();
  vi.mocked(enqueueVideoGenerationJob).mockReset().mockResolvedValue(undefined);
  vi.mocked(enqueueImageGenerationJob).mockReset().mockResolvedValue(undefined);
  vi.mocked(logger.error).mockClear();
  vi.mocked(logger.warn).mockClear();
});

describe("SceneCardGenerateController.generate 响应写出（IKIQGQ）", () => {
  it("素材门终局拒绝（1034 invalid_reference）→ 抛 DomainError，状态与码表一致（兜底 400），不再写 200 信封", async () => {
    const { controller, res } = makeController();
    vi.mocked(handleSceneCardGenerate).mockResolvedValue(
      fail(INVALID_REFERENCE_CODE, "素材未通过审核，不能用于视频生成", {
        code: ERROR_INVALID_REFERENCE,
      }) as never,
    );

    const rejection = controller.generate(USER, "523", "12", {}, "idem-1", undefined, res);
    await expect(rejection).rejects.toBeInstanceOf(DomainError);
    await expect(rejection).rejects.toMatchObject({
      code: INVALID_REFERENCE_CODE,
      status: httpStatusForCode(INVALID_REFERENCE_CODE),
      message: "素材未通过审核，不能用于视频生成",
    });
    expect(httpStatusForCode(INVALID_REFERENCE_CODE)).toBeGreaterThanOrEqual(400);
    expect(enqueueVideoGenerationJob).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("越权隐藏（100301 forbidden）→ HTTP 404，不泄露存在性", async () => {
    const { controller, res } = makeController();
    vi.mocked(handleSceneCardGenerate).mockResolvedValue(
      fail(RESOURCE_NOT_FOUND_CODE, "资源不存在") as never,
    );

    const rejection = controller.generate(USER, "523", "12", {}, "idem-1", undefined, res);
    await expect(rejection).rejects.toBeInstanceOf(DomainError);
    await expect(rejection).rejects.toMatchObject({
      code: RESOURCE_NOT_FOUND_CODE,
      status: httpStatusForCode(RESOURCE_NOT_FOUND_CODE),
    });
    expect(httpStatusForCode(RESOURCE_NOT_FOUND_CODE)).toBe(404);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("成功受理 → 仍写 202 + 原样信封，并照常入队视频 job", async () => {
    const { controller, res } = makeController();
    const envelope = ok({
      scene_card_id: "12",
      generation_job_id: "400",
      record_id: "7",
      preset_version: 3,
      cursor: "1",
    });
    vi.mocked(handleSceneCardGenerate).mockResolvedValue(envelope as never);

    await controller.generate(USER, "523", "12", {}, "idem-1", undefined, res);

    expect(enqueueVideoGenerationJob).toHaveBeenCalledWith("400");
    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(envelope);
  });

  // IKJ80Q：回退路径（catch 后仅记日志，任务由 worker 恢复扫描捞起）的日志分级——
  // 环境缺配 → WARN + 写明任务仍会派发；真派发失败 → ERROR。
  it("环境缺配（未配置 ROCKETMQ_ENDPOINTS）→ enqueue 失败降 WARN 说明恢复扫描兜底，不打 ERROR，仍写 202（IKJ80Q）", async () => {
    const { controller, res } = makeController();
    const envelope = ok({
      scene_card_id: "12",
      generation_job_id: "402",
      record_id: "7",
      preset_version: 3,
      cursor: "1",
    });
    vi.mocked(handleSceneCardGenerate).mockResolvedValue(envelope as never);
    vi.mocked(enqueueVideoGenerationJob).mockRejectedValueOnce(
      new Error(
        "未配置 ROCKETMQ_ENDPOINTS（测试环境 gRPC 端点，如 115.190.244.91:8081）",
      ),
    );

    await controller.generate(USER, "523", "12", {}, "idem-2", undefined, res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("恢复扫描"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("jobId=402"));
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("真派发失败（其他错误）→ 保持 ERROR（IKJ80Q）", async () => {
    const { controller, res } = makeController();
    const envelope = ok({
      scene_card_id: "12",
      generation_job_id: "403",
      record_id: "7",
      preset_version: 3,
      cursor: "1",
    });
    vi.mocked(handleSceneCardGenerate).mockResolvedValue(envelope as never);
    vi.mocked(enqueueVideoGenerationJob).mockRejectedValueOnce(
      new Error("gRPC 通道断开"),
    );

    await controller.generate(USER, "523", "12", {}, "idem-3", undefined, res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("enqueue video job failed"),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("SceneCardGenerateController.storyboardPreview 响应写出（IKIQGQ）", () => {
  it("余额不足（100405 quota_insufficient）→ 抛 DomainError，状态与码表一致（兜底 400），不再写 200 信封", async () => {
    const { controller, res } = makeController();
    vi.mocked(handleStoryboardPreviewCreate).mockResolvedValue(
      fail(PLAN_APPLICATION_QUOTA_INSUFFICIENT_CODE, "余额不足") as never,
    );

    const rejection = controller.storyboardPreview(USER, "523", "12", {}, "idem-1", undefined, res);
    await expect(rejection).rejects.toBeInstanceOf(DomainError);
    await expect(rejection).rejects.toMatchObject({
      code: PLAN_APPLICATION_QUOTA_INSUFFICIENT_CODE,
      status: httpStatusForCode(PLAN_APPLICATION_QUOTA_INSUFFICIENT_CODE),
      message: "余额不足",
    });
    expect(httpStatusForCode(PLAN_APPLICATION_QUOTA_INSUFFICIENT_CODE)).toBeGreaterThanOrEqual(400);
    expect(enqueueImageGenerationJob).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("越权隐藏（100301 forbidden）→ HTTP 404，不泄露存在性", async () => {
    const { controller, res } = makeController();
    vi.mocked(handleStoryboardPreviewCreate).mockResolvedValue(
      fail(RESOURCE_NOT_FOUND_CODE, "资源不存在") as never,
    );

    const rejection = controller.storyboardPreview(USER, "523", "12", {}, "idem-1", undefined, res);
    await expect(rejection).rejects.toBeInstanceOf(DomainError);
    await expect(rejection).rejects.toMatchObject({
      code: RESOURCE_NOT_FOUND_CODE,
      status: httpStatusForCode(RESOURCE_NOT_FOUND_CODE),
    });
    expect(httpStatusForCode(RESOURCE_NOT_FOUND_CODE)).toBe(404);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("成功受理 → 仍写 202 + 原样信封，并照常入队图片 job", async () => {
    const { controller, res } = makeController();
    const envelope = ok({
      preview_id: "5",
      scene_card_id: "12",
      generation_job_id: "401",
      cursor: "1",
    });
    vi.mocked(handleStoryboardPreviewCreate).mockResolvedValue(envelope as never);

    await controller.storyboardPreview(USER, "523", "12", {}, "idem-1", undefined, res);

    expect(enqueueImageGenerationJob).toHaveBeenCalledWith("401");
    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(envelope);
  });

  // IKJ80Q：fire-and-forget 的 catch 分支同款分级——真派发失败保持 ERROR（缺配分支
  // 已由 generate video 用例覆盖，判别函数共享同一处收口）。
  it("真派发失败（其他错误）→ fire-and-forget catch 保持 ERROR（IKJ80Q）", async () => {
    const { controller, res } = makeController();
    const envelope = ok({
      preview_id: "6",
      scene_card_id: "12",
      generation_job_id: "404",
      cursor: "1",
    });
    vi.mocked(handleStoryboardPreviewCreate).mockResolvedValue(envelope as never);
    vi.mocked(enqueueImageGenerationJob).mockRejectedValueOnce(
      new Error("gRPC 通道断开"),
    );

    await controller.storyboardPreview(USER, "523", "12", {}, "idem-4", undefined, res);
    // fire-and-forget：让出一个宏任务，等 .catch 回调落地。
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(res.status).toHaveBeenCalledWith(202);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("enqueue image job failed"),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

// DomainError 本身不写响应：投影由 AllExceptionsFilter 负责（唯一投影出入口），
// 每个拒绝用例里 res.status/res.json 未被调用即是「控制器把失败交出去」的断言。
