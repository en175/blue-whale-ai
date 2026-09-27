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
const { SceneCardGenerateController } = await import(
  "./scene-card-generate.controller.js"
);

function makeController() {
  const controller = new SceneCardGenerateController(
    { repo: {} } as never, // sceneCard：handler 已 mock，repo 不触达
    { repo: {} } as never, // storyboard：同上
    {} as never, // cost：estimator 缺省
    {} as never, // account：不传 sk- token 则 quotaCheck 不接线
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
});

// DomainError 本身不写响应：投影由 AllExceptionsFilter 负责（唯一投影出入口），
// 每个拒绝用例里 res.status/res.json 未被调用即是「控制器把失败交出去」的断言。
