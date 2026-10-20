import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageCutoutsService } from "./image-cutouts.service.js";

const { lockMock, bindingViewMock, readIdemMock, writeRowsMock, writeIdemMock } = vi.hoisted(() => ({
  lockMock: vi.fn(),
  bindingViewMock: vi.fn(),
  readIdemMock: vi.fn(),
  writeRowsMock: vi.fn(),
  writeIdemMock: vi.fn(),
}));

vi.mock("@lib/shared/persistence/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lib/shared/persistence/index.js")>();
  return {
    ...actual,
    lockCanvasRecoveryForAcceptance: lockMock,
    canvasBindingView: bindingViewMock,
    readCreateIdempotency: readIdemMock,
    writeCanvasRecoveryRows: writeRowsMock,
    transactionWithUniqueRetry: (_prisma: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn(_prisma),
  };
});

vi.mock("@lib/shared/persistence/generation-job-idempotency.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@lib/shared/persistence/generation-job-idempotency.js")>();
  return { ...actual, writeCreateIdempotency: writeIdemMock };
});

beforeEach(() => {
  vi.clearAllMocks();
});

const VALID_GENERAL_BODY = {
  source_asset_id: "88",
  target_node_id: "node-1",
  cutout_scene: "general",
};

const VALID_HUMAN_BODY = {
  source_asset_id: "88",
  target_node_id: "node-1",
  cutout_scene: "human",
  need_contour: true,
  contour_color: "#FFFFFF",
  contour_size: 10,
  need_crop_background: false,
};

const VALID_PRODUCT_BODY = {
  source_asset_id: "88",
  target_node_id: "node-1",
  cutout_scene: "product",
  need_contour: false,
  contour_color: "#FFFFFF",
  contour_size: 10,
  need_crop_background: true,
};

function makeImageAsset(overrides: Record<string, unknown> = {}) {
  return {
    type: "image",
    url: "https://tos.example.com/uploads/9/image/a.png",
    storage_key: "uploads/9/image/a.png",
    mime: "image/png",
    size: 5_000_000n,
    width: 4000,
    height: 3000,
    ...overrides,
  };
}

function makeService(overrides: {
  project?: unknown;
  assets?: unknown;
  createJob?: unknown;
  billing?: unknown;
} = {}) {
  const project = overrides.project ?? { findOwnedById: vi.fn().mockResolvedValue({ id: 55n }) };
  const assets =
    overrides.assets ??
    {
      findOwnedSource: vi.fn().mockImplementation(async (_id: string) => makeImageAsset()),
    };
  const billing =
    overrides.billing ??
    {
      jobBilling: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };
  const create = overrides.createJob ?? vi.fn().mockResolvedValue({ id: 400n });
  const costCreate = vi.fn();
  const client: Record<string, unknown> = {
    generation_jobs: {
      create,
      findUnique: vi.fn().mockResolvedValue({ status: "processing" }),
    },
    cost_reservations: { create: costCreate },
  };
  client.$transaction = vi.fn((fn: (tx: unknown) => Promise<unknown>) =>
    fn(client),
  );
  const prisma = { client };
  return {
    service: new ImageCutoutsService(
      prisma as never,
      project as never,
      assets as never,
      billing as never,
    ),
    create,
    costCreate,
    assets,
    billing,
  };
}

describe("ImageCutoutsService.create：契约 schema 复核", () => {
  it("rejects a missing source_asset_id", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_GENERAL_BODY, source_asset_id: undefined });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("source_asset_id");
  });

  it("rejects an unknown cutout_scene with a readable reason", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_GENERAL_BODY,
      cutout_scene: "animal",
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("抠图场景");
  });

  it("rejects the general scene carrying enhancement keys (scene forbids them)", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_GENERAL_BODY,
      need_contour: true,
      contour_color: "#FFFFFF",
      contour_size: 10,
      need_crop_background: false,
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("通用场景不支持");
  });

  it("rejects the human scene missing need_contour with a readable reason", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      source_asset_id: "88",
      target_node_id: "node-1",
      cutout_scene: "human",
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("need_contour");
  });

  it("rejects a contour_size outside [1,100]", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_HUMAN_BODY,
      contour_size: 101,
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("contour_size");
  });

  it("rejects a non-white contour color", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_HUMAN_BODY,
      contour_color: "#FF0000",
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("contour_color");
  });

  it("rejects a non-numeric asset id", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_GENERAL_BODY, source_asset_id: "08x" });
    expect(result.code).not.toBe(200);
  });

  it("rejects an extra key", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_GENERAL_BODY, extra: 1 });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("不支持的参数");
  });
});

describe("ImageCutoutsService.create：归属与媒体类型复核", () => {
  it("rejects an unknown project", async () => {
    const { service } = makeService({
      project: { findOwnedById: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects a source asset not owned by the user", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects a non-image asset with a readable reason", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ type: "video" })) },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("图片");
  });
});

describe("ImageCutoutsService.create：输入门槛复核（官方 PDF 输入限制，按场景两档）", () => {
  it("accepts the general scene at the exact long-side boundary 10240 (total pixels within 40MP)", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: 10240, height: 3906 })) },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).toBe(200);
  });

  it("accepts the general scene at exactly 40MP total pixels (10000x4000)", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: 10000, height: 4000 })) },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).toBe(200);
  });

  it("rejects the general scene when total pixels exceed 40MP (sides within limits)", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: 10000, height: 4001 })) },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("总像素超过 40MP");
  });

  it("rejects the general scene when the long side exceeds 10240", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi
          .fn()
          .mockResolvedValueOnce(makeImageAsset({ width: 10241, height: 3000 }))
          .mockResolvedValueOnce(makeImageAsset({ width: 3000, height: 10241 })),
      },
    });
    expect((await service.create("9", "55", VALID_GENERAL_BODY)).msg).toContain("长边超过");
    expect((await service.create("9", "55", VALID_GENERAL_BODY)).msg).toContain("长边超过");
  });

  it("rejects the general scene when the short side exceeds 6000 (long side within limit)", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: 7000, height: 6001 })) },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("短边超过");
  });

  it("accepts the human scene at the exact boundary 7680x4320", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: 7680, height: 4320 })) },
    });
    const result = await service.create("9", "55", VALID_HUMAN_BODY);
    expect(result.code).toBe(200);
  });

  it("rejects the human scene when the long side exceeds 7680", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: 7681, height: 4000 })) },
    });
    const result = await service.create("9", "55", VALID_HUMAN_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("长边超过 7680");
  });

  it("rejects the human scene when the short side exceeds 4320", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: 5000, height: 4321 })) },
    });
    const result = await service.create("9", "55", VALID_HUMAN_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("短边超过 4320");
  });

  it("applies the two-tier limits per scene: same image passes general but is rejected for human and product", async () => {
    const asset = makeImageAsset({ width: 8000, height: 5000 });
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(asset) },
    });
    expect((await service.create("9", "55", VALID_GENERAL_BODY)).code).toBe(200);
    expect((await service.create("9", "55", VALID_HUMAN_BODY)).code).not.toBe(200);
    expect((await service.create("9", "55", VALID_PRODUCT_BODY)).code).not.toBe(200);
  });

  it("rejects a file over 30MB", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(
          makeImageAsset({ size: BigInt(30 * 1024 * 1024) + 1n }),
        ),
      },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("30MB");
  });

  it("rejects a webp asset with a readable reason (mime)", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ mime: "image/webp" })) },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("格式");
  });

  it("rejects a gif asset (extension fallback when mime missing)", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(
          makeImageAsset({
            mime: null,
            url: "https://tos.example.com/uploads/9/image/a.gif",
            storage_key: "uploads/9/image/a.gif",
          }),
        ),
      },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("格式");
  });

  it("accepts a heic asset", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ mime: "image/heic" })) },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).toBe(200);
  });

  it("accepts a jpeg asset (jpg 与 jpeg 同源)", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(
          makeImageAsset({
            mime: "image/jpeg",
            url: "https://tos.example.com/uploads/9/image/a.jpg",
            storage_key: "uploads/9/image/a.jpg",
          }),
        ),
      },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).toBe(200);
  });

  it("lets an asset without recorded dimensions pass to the supplier gate", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: null, height: null })),
      },
    });
    const result = await service.create("9", "55", VALID_HUMAN_BODY);
    expect(result.code).toBe(200);
  });
});

describe("ImageCutoutsService.create：落任务与免费口径", () => {
  it("creates an image_cutout job for the general scene with the frozen three-key input", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({ job_id: "400", status: "queued" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "image_cutout",
        source: "image_cutout",
        status: "queued",
        user_id: 9n,
        project_id: 55n,
        input: VALID_GENERAL_BODY,
        next_action_at: expect.any(Date),
      }),
    });
  });

  it("creates an image_cutout job for the human scene with the frozen seven-key input", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_HUMAN_BODY);
    expect(result.code).toBe(200);
    expect(create.mock.calls[0][0].data.input).toEqual(VALID_HUMAN_BODY);
  });

  it("is free-tier: no cost reservation, no provider row", async () => {
    const { service, create, costCreate } = makeService();
    const result = await service.create("9", "55", VALID_PRODUCT_BODY);
    expect(result.code).toBe(200);
    expect(costCreate).not.toHaveBeenCalled();
    const data = create.mock.calls[0][0].data;
    expect(Object.keys(data)).not.toContain("provider");
  });
});
describe("IKJLTX：已受理意图重放先于素材等可变状态（B.3 受理事务顺序）", () => {
  const SUBMISSION_ID = "0a1b2c3d-0000-4000-8000-00000000a001";

  const CANVAS_BINDING = {
    protocol_version: 1,
    submission_id: SUBMISSION_ID,
    target_node_id: "node-1",
    expected_binding_revision: 0,
    recovery_seed: {
      target: { role: "result-placeholder", x: 0, y: 0, width: 100, height: 100, name: "" },
      sources: [],
    },
  };

  function stubFreshAcceptance() {
    readIdemMock.mockResolvedValue(null);
    lockMock.mockResolvedValue({
      kind: "plan",
      plan: { acceptance: {}, bindingRevision: 1, previousTargetSnapshot: null, supersededSubmissionId: null },
    });
    bindingViewMock.mockResolvedValue(null);
  }

  it("素材删除后同载荷重放返回原任务 501 与原关联，不重新拒绝、不重复受理", async () => {
    stubFreshAcceptance();
    const findOwnedSource = vi
      .fn()
      .mockResolvedValueOnce(makeImageAsset())
      .mockResolvedValueOnce(null);
    const { service, create, costCreate } = makeService({
      assets: { findOwnedSource },
    });

    const first = await service.create(
      "9",
      "55",
      { ...VALID_GENERAL_BODY, canvas_binding: CANVAS_BINDING },
      SUBMISSION_ID,
    );
    expect(first.code).toBe(200);
    expect(first.data).toMatchObject({ job_id: "400", status: "queued" });

    readIdemMock.mockResolvedValue({ generation_job_id: "501", cursor: 0 });
    bindingViewMock.mockResolvedValue({
      protocol_version: 1,
      submission_id: SUBMISSION_ID,
      target_node_id: "node-1",
      binding_revision: 1,
      job_id: "501",
      is_current: true,
    });
    const replay = await service.create(
      "9",
      "55",
      { ...VALID_GENERAL_BODY, canvas_binding: CANVAS_BINDING },
      SUBMISSION_ID,
    );
    expect(replay.code).toBe(200);
    expect(replay.data).toMatchObject({
      job_id: "501",
      status: "processing",
      canvas_binding: { submission_id: SUBMISSION_ID, job_id: "501", is_current: true },
    });
    expect(findOwnedSource).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(costCreate).not.toHaveBeenCalled();
    expect(writeRowsMock).toHaveBeenCalledTimes(1);
    expect(writeIdemMock).toHaveBeenCalledTimes(1);
  });

  it("同键异载荷重放仍判幂等冲突，不落任何新行", async () => {
    stubFreshAcceptance();
    const { service, create } = makeService();
    const first = await service.create(
      "9",
      "55",
      { ...VALID_GENERAL_BODY, canvas_binding: CANVAS_BINDING },
      SUBMISSION_ID,
    );
    expect(first.code).toBe(200);

    readIdemMock.mockResolvedValue({ kind: "idempotency_conflict" });
    const replay = await service.create(
      "9",
      "55",
      { ...VALID_HUMAN_BODY, canvas_binding: CANVAS_BINDING },
      SUBMISSION_ID,
    );
    expect(replay.code).toBe(100409);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("未受理过的非法输入仍走既有校验拒绝，不因回读前置放宽", async () => {
    readIdemMock.mockResolvedValue(null);
    const { service, create } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create(
      "9",
      "55",
      { ...VALID_GENERAL_BODY, canvas_binding: CANVAS_BINDING },
      SUBMISSION_ID,
    );
    expect(result.code).toBe(100301);
    expect(create).not.toHaveBeenCalled();
  });

  it("跨项目/无权限请求仍先被项目归属校验拒绝，不读幂等", async () => {
    const { service } = makeService({
      project: { findOwnedById: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create(
      "9",
      "55",
      { ...VALID_GENERAL_BODY, canvas_binding: CANVAS_BINDING },
      SUBMISSION_ID,
    );
    expect(result.code).toBe(100301);
    expect(readIdemMock).not.toHaveBeenCalled();
  });

  it("无 canvas_binding 的历史请求不前置读幂等，保持原建行路径", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).toBe(200);
    expect(readIdemMock).not.toHaveBeenCalled();
    expect(lockMock).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("ImageCutoutsService.create：按工具计价计费", () => {
  it("提交前按 image_cutout 取计费钩子，建行后扣款", async () => {
    const charge = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);
    const { service, billing, create } = makeService({
      billing: {
        jobBilling: vi.fn().mockResolvedValue({ charge, release }),
        release,
      },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).toBe(200);
    expect((billing as { jobBilling: ReturnType<typeof vi.fn> }).jobBilling).toHaveBeenCalledWith(
      "image_cutout",
      "9",
      VALID_GENERAL_BODY,
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(charge).toHaveBeenCalledWith(400);
  });

  it("扣款失败时提交上抛，且不产生退款事件", async () => {
    const charge = vi.fn().mockRejectedValue(new Error("余额不足"));
    const release = vi.fn().mockResolvedValue(undefined);
    const { service, create } = makeService({
      billing: {
        jobBilling: vi.fn().mockResolvedValue({ charge, release }),
        release,
      },
    });
    await expect(service.create("9", "55", VALID_GENERAL_BODY)).rejects.toThrow("余额不足");
    expect(create).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });
});
