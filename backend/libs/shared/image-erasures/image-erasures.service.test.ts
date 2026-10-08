import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageErasuresService } from "./image-erasures.service.js";
import { RecoveryContractError } from "@lib/shared/persistence/index.js";

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

const VALID_TEXT_BODY = {
  source_asset_id: "88",
  target_node_id: "node-1",
  erase_scene: "full_screen_text_erase",
};

const VALID_AREA_BODY = {
  source_asset_id: "88",
  target_node_id: "node-1",
  erase_scene: "selected_area_erase",
  mask_asset_id: "99",
};

function makeImageAsset(overrides: Record<string, unknown> = {}) {
  return {
    type: "image",
    url: "https://tos.example.com/uploads/9/image/a.png",
    storage_key: "uploads/9/image/a.png",
    mime: "image/png",
    size: 5_000_000n,
    width: 1920,
    height: 1080,
    ...overrides,
  };
}

function makeService(overrides: {
  project?: unknown;
  assets?: unknown;
  createJob?: unknown;
} = {}) {
  const project = overrides.project ?? { findOwnedById: vi.fn().mockResolvedValue({ id: 55n }) };
  const assets =
    overrides.assets ??
    {
      findOwnedSource: vi.fn().mockImplementation(async (id: string) =>
        id === "99" ? makeImageAsset() : makeImageAsset(),
      ),
    };
  const create = overrides.createJob ?? vi.fn().mockResolvedValue({ id: 400n });
  const costCreate = vi.fn();
  const prisma = {
    client: {
      generation_jobs: { create, findUnique: vi.fn().mockResolvedValue({ status: "queued" }) },
      cost_reservations: { create: costCreate },
    },
  };
  return {
    service: new ImageErasuresService(prisma as never, project as never, assets as never),
    create,
    costCreate,
    assets,
  };
}

describe("ImageErasuresService.create：契约 schema 复核", () => {
  it("rejects a missing source_asset_id", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_TEXT_BODY, source_asset_id: undefined });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("source_asset_id");
  });

  it("rejects an unknown erase_scene with a readable reason", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_TEXT_BODY,
      erase_scene: "full_screen_icon_erase",
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("擦除场景");
  });

  it("rejects selected_area_erase missing mask_asset_id with a readable reason", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_AREA_BODY,
      mask_asset_id: undefined,
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("遮罩");
  });

  it("rejects full_screen_text_erase carrying mask_asset_id (scene forbids mask)", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_TEXT_BODY,
      mask_asset_id: "99",
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("不支持");
  });

  it("rejects a non-numeric asset id", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_TEXT_BODY, source_asset_id: "08x" });
    expect(result.code).not.toBe(200);
  });

  it("rejects an extra key", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_TEXT_BODY, extra: 1 });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("不支持的参数");
  });
});

describe("ImageErasuresService.create：归属与媒体类型复核", () => {
  it("rejects an unknown project", async () => {
    const { service } = makeService({
      project: { findOwnedById: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects a source asset not owned by the user", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects a non-image asset with a readable reason", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ type: "video" })) },
    });
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("图片");
  });

  it("rejects a mask asset not owned by the user", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockImplementation(async (id: string) =>
          id === "99" ? null : makeImageAsset(),
        ),
      },
    });
    const result = await service.create("9", "55", VALID_AREA_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects a non-image mask asset", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockImplementation(async (id: string) =>
          id === "99" ? makeImageAsset({ type: "video" }) : makeImageAsset(),
        ),
      },
    });
    const result = await service.create("9", "55", VALID_AREA_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("遮罩");
  });
});

describe("ImageErasuresService.create：输入门槛复核（官方 PDF 输入限制）", () => {
  it("accepts at the exact boundary 2560x1440 and vertical 1440x2560 (short/long-side semantics)", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi
          .fn()
          .mockResolvedValueOnce(makeImageAsset({ width: 2560, height: 1440 }))
          .mockResolvedValueOnce(makeImageAsset({ width: 1440, height: 2560 })),
      },
    });
    expect((await service.create("9", "55", VALID_TEXT_BODY)).code).toBe(200);
    expect((await service.create("9", "55", VALID_TEXT_BODY)).code).toBe(200);
  });

  it("rejects when long side exceeds 2560 (landscape and vertical) with a readable reason", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi
          .fn()
          .mockResolvedValueOnce(makeImageAsset({ width: 2561, height: 100 }))
          .mockResolvedValueOnce(makeImageAsset({ width: 100, height: 2561 })),
      },
    });
    expect((await service.create("9", "55", VALID_TEXT_BODY)).msg).toContain("长边超过");
    expect((await service.create("9", "55", VALID_TEXT_BODY)).msg).toContain("长边超过");
  });

  it("rejects when short side exceeds 1440 with a readable reason", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: 2000, height: 1441 })),
      },
    });
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("短边超过");
  });

  it("rejects when a side is below 10px", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: 9, height: 1080 })),
      },
    });
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("尺寸");
  });

  it("rejects a file over 10MB", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(
          makeImageAsset({ size: BigInt(10 * 1024 * 1024) + 1n }),
        ),
      },
    });
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("10MB");
  });

  it("rejects a webp asset with a readable reason (mime)", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ mime: "image/webp" })) },
    });
    const result = await service.create("9", "55", VALID_TEXT_BODY);
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
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("格式");
  });

  it("accepts a heic asset", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ mime: "image/heic" })) },
    });
    const result = await service.create("9", "55", VALID_TEXT_BODY);
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
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).toBe(200);
  });

  it("lets an asset without recorded dimensions pass to the supplier gate", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: null, height: null })),
      },
    });
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).toBe(200);
  });
});

describe("ImageErasuresService.create：落任务与免费口径", () => {
  it("creates an image_erase job for the full-screen text scene with the frozen three-key input", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({ job_id: "400", status: "queued" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "image_erase",
        source: "image_erase",
        status: "queued",
        user_id: 9n,
        project_id: 55n,
        input: VALID_TEXT_BODY,
        next_action_at: expect.any(Date),
      }),
    });
  });

  it("creates an image_erase job for the selected-area scene with the frozen four-key input", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_AREA_BODY);
    expect(result.code).toBe(200);
    expect(create.mock.calls[0][0].data.input).toEqual(VALID_AREA_BODY);
  });

  it("is free-tier: no cost reservation, no provider row", async () => {
    const { service, create, costCreate } = makeService();
    const result = await service.create("9", "55", VALID_AREA_BODY);
    expect(result.code).toBe(200);
    expect(costCreate).not.toHaveBeenCalled();
    const data = create.mock.calls[0][0].data;
    expect(Object.keys(data)).not.toContain("provider");
  });
});
describe("ImageErasuresService.create：恢复协议 v1 接入（IKJJQW）", () => {
  beforeEach(() => {
    readIdemMock.mockReset().mockResolvedValue(null);
    lockMock.mockReset().mockImplementation(async (_tx: unknown, acceptance: { binding: unknown }) => ({
      kind: "plan",
      plan: { acceptance, bindingRevision: 1, previousTargetSnapshot: null, supersededSubmissionId: null },
    }));
    bindingViewMock.mockReset().mockResolvedValue({
      protocol_version: 1,
      submission_id: SUBMISSION_ID,
      target_node_id: "node-1",
      binding_revision: 1,
      job_id: "400",
      is_current: true,
    });
  });

  it("accepts a canvas_binding submission and echoes the binding view", async () => {
    const { service, create } = makeService();
    const result = await service.create(
      "9",
      "55",
      { ...VALID_TEXT_BODY, canvas_binding: CANVAS_BINDING },
      SUBMISSION_ID,
    );
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({
      job_id: "400",
      status: "queued",
      canvas_binding: { submission_id: SUBMISSION_ID, binding_revision: 1, is_current: true },
    });
    expect(create.mock.calls[0][0].data.input).toEqual(VALID_TEXT_BODY);
    expect(lockMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a canvas_binding whose submission_id differs from Idempotency-Key", async () => {
    const { service, create } = makeService();
    const result = await service.create(
      "9",
      "55",
      { ...VALID_TEXT_BODY, canvas_binding: CANVAS_BINDING },
      "11111111-2222-4333-8444-555555555555",
    );
    expect(result.code).toBe(400);
    expect(result.data).toMatchObject({ reason: "invalid_recovery_payload" });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a structurally invalid canvas_binding", async () => {
    const { service, create } = makeService();
    const result = await service.create(
      "9",
      "55",
      { ...VALID_TEXT_BODY, canvas_binding: { protocol_version: 9 } },
      SUBMISSION_ID,
    );
    expect(result.code).toBe(400);
    expect(result.data).toMatchObject({ reason: "invalid_recovery_payload" });
    expect(create).not.toHaveBeenCalled();
  });

  it("returns the controlled conflict envelope without creating a job row", async () => {
    const { service, create } = makeService();
    lockMock.mockRejectedValue(
      new RecoveryContractError({
        code: 409,
        msg: "目标节点承接版本已变化，请刷新后重试",
        data: { reason: "canvas_binding_conflict", currentBindingRevision: 7 },
      }),
    );
    const result = await service.create(
      "9",
      "55",
      { ...VALID_TEXT_BODY, canvas_binding: CANVAS_BINDING },
      SUBMISSION_ID,
    );
    expect(result.code).toBe(409);
    expect(result.data).toMatchObject({ reason: "canvas_binding_conflict", currentBindingRevision: 7 });
    expect(create).not.toHaveBeenCalled();
  });

  it("replays the original job for a same-key same-hash retry (回执丢失后重放)", async () => {
    const { service, create } = makeService();
    readIdemMock.mockResolvedValue({ generation_job_id: "400", cursor: 0 });
    bindingViewMock.mockResolvedValue(null);
    const result = await service.create(
      "9",
      "55",
      { ...VALID_TEXT_BODY, canvas_binding: CANVAS_BINDING },
      SUBMISSION_ID,
    );
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({ job_id: "400", status: "queued" });
    expect(create).not.toHaveBeenCalled();
  });
});
