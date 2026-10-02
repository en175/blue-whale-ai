// IKHK98：智能抠像创建入口复核矩阵与幂等/同事务落库单测（先例：
// video-scene-splits.service.test.ts + vocal-splits.service.test.ts 的缺省补默认口径）。
// 只测外部可见行为：拒绝原因可读、mode/format/background_color 组合矩阵（含缺省补默认）、
// client_token 幂等三态（重放/冲突/新建）、任务行与幂等行同事务原子落库、落库参数冻结
// （补齐后的 format / background_color 原样冻结）、免费口径无成本预留、凭证冻结。
// IKJJQW：追加恢复协议 v1 接入分支（client_token==submission_id 承载 / 受理事务 / 受控错误）。
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VideoMattingsService } from "./video-mattings.service.js";
import { RecoveryContractError } from "@lib/shared/persistence/index.js";

const { lockMock, bindingViewMock } = vi.hoisted(() => ({
  lockMock: vi.fn(),
  bindingViewMock: vi.fn(),
}));

vi.mock("@lib/shared/persistence/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lib/shared/persistence/index.js")>();
  return {
    ...actual,
    lockCanvasRecoveryForAcceptance: lockMock,
    canvasBindingView: bindingViewMock,
    writeCanvasRecoveryRows: vi.fn(),
  };
});

const SUBMISSION_ID = "0a1b2c3d-0000-4000-8000-00000000b002";

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

const VALID_BODY = {
  source_asset_id: "88",
  target_node_id: "node-1",
  mode: "portrait",
  format: "WEBM",
  client_token: "tok-001",
};

/** 默认源素材：1920x1080 mp4、5 分钟；时长权威值齐备且在门槛内。 */
function makeVideoAsset(overrides: Record<string, unknown> = {}) {
  return {
    type: "video",
    url: "https://tos.example.com/uploads/9/video/a.mp4",
    storage_key: "uploads/9/video/a.mp4",
    mime: "video/mp4",
    width: 1920,
    height: 1080,
    duration_ms: 5 * 60_000,
    ...overrides,
  };
}

function makeService(overrides: {
  project?: unknown;
  assets?: unknown;
  idemFindUnique?: unknown;
  jobCreate?: unknown;
  replayedJob?: unknown;
} = {}) {
  const project = overrides.project ?? { findOwnedById: vi.fn().mockResolvedValue({ id: 55n }) };
  const assets =
    overrides.assets ??
    {
      findOwnedSource: vi.fn().mockResolvedValue(makeVideoAsset()),
    };
  const tx = {
    command_idempotency: {
      findUnique:
        overrides.idemFindUnique ?? vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    generation_jobs: {
      create: overrides.jobCreate ?? vi.fn().mockResolvedValue({ id: 400n }),
      findUnique: overrides.replayedJob ?? vi.fn(),
    },
    // 免费口径哨兵：任何成本预留写入都会在这里暴露。
    cost_reservations: { create: vi.fn() },
  };
  // IKJJQW：受理主体（media-tool-recovery）的锁外幂等回读与状态现查直接走 prisma client，
  // 事务体经 $transaction 拿 tx——两处必须是同一套 mock（同键重放在锁外命中）。
  const client = {
    command_idempotency: tx.command_idempotency,
    generation_jobs: tx.generation_jobs,
    cost_reservations: tx.cost_reservations,
    $transaction: vi.fn(async (operation: (t: unknown) => Promise<unknown>) => operation(tx)),
  };
  const prisma = { client };
  return {
    service: new VideoMattingsService(prisma as never, project as never, assets as never),
    tx,
    client,
    project,
    assets,
  };
}

describe("VideoMattingsService.create：契约 schema 复核（mode / format / background_color 组合矩阵）", () => {
  it("rejects a missing or unknown mode with a readable reason", async () => {
    const { service } = makeService();
    for (const mode of [undefined, "human", "green-screen", 1, null]) {
      const result = await service.create("9", "55", { ...VALID_BODY, mode });
      expect(result.code).not.toBe(200);
      if (mode !== undefined) expect(result.msg).toContain("抠像模式");
    }
  });

  it("rejects an unknown format (no MOV tier) with a readable reason", async () => {
    const { service } = makeService();
    for (const format of ["MOV", "mov", "webm", 1, null]) {
      const result = await service.create("9", "55", { ...VALID_BODY, format });
      expect(result.code).not.toBe(200);
      if (format !== null && typeof format === "string") expect(result.msg).toContain("输出格式");
    }
  });

  it("rejects an illegal background_color", async () => {
    const { service } = makeService();
    for (const backgroundColor of ["GREEN", "blue", 1]) {
      const result = await service.create("9", "55", {
        ...VALID_BODY,
        format: "MP4",
        background_color: backgroundColor,
      });
      expect(result.code).not.toBe(200);
      expect(result.msg).toContain("背景色");
    }
    // null 同样明确拒绝（不静默回退默认）。
    const nullColor = await service.create("9", "55", {
      ...VALID_BODY,
      format: "MP4",
      background_color: null,
    });
    expect(nullColor.code).not.toBe(200);
  });

  it("rejects background_color on WEBM (transparent) but accepts MP4 with all three colors", async () => {
    const { service } = makeService();
    // WEBM 冻结形态不接受背景色（显式传入即拒，补默认逻辑不触碰 WEBM）。
    const webm = await service.create("9", "55", {
      ...VALID_BODY,
      background_color: "white",
    });
    expect(webm.code).not.toBe(200);
    expect(webm.msg).toContain("WEBM");
    // MP4 三底色全过。
    for (const backgroundColor of ["white", "black", "green"]) {
      const result = await service.create("9", "55", {
        ...VALID_BODY,
        format: "MP4",
        background_color: backgroundColor,
      });
      expect(result.code).toBe(200);
    }
  });

  it("fills WEBM when format is omitted and freezes it", async () => {
    const { service, tx } = makeService();
    const body = { ...VALID_BODY };
    delete body.format;
    const result = await service.create("9", "55", body);
    expect(result.code).toBe(200);
    const input = tx.generation_jobs.create.mock.calls[0][0].data.input;
    expect(input.format).toBe("WEBM");
    expect("background_color" in input).toBe(false);
  });

  it("fills white when MP4 omits background_color and freezes it", async () => {
    const { service, tx } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, format: "MP4" });
    expect(result.code).toBe(200);
    const input = tx.generation_jobs.create.mock.calls[0][0].data.input;
    expect(input.format).toBe("MP4");
    expect(input.background_color).toBe("white");
  });

  it("accepts both modes and both formats", async () => {
    const { service } = makeService();
    for (const mode of ["portrait", "greenscreen"]) {
      for (const format of ["WEBM", "MP4"]) {
        const result = await service.create("9", "55", {
          ...VALID_BODY,
          mode,
          format,
          ...(format === "MP4" ? { background_color: "black" } : {}),
        });
        expect(result.code).toBe(200);
      }
    }
  });

  it("rejects a missing source_asset_id / non-numeric asset id / empty target_node_id / extra key", async () => {
    const { service } = makeService();
    const missingSource = await service.create("9", "55", { ...VALID_BODY, source_asset_id: undefined });
    expect(missingSource.code).not.toBe(200);
    expect(missingSource.msg).toContain("source_asset_id");
    const badAsset = await service.create("9", "55", { ...VALID_BODY, source_asset_id: "08x" });
    expect(badAsset.code).not.toBe(200);
    const emptyNode = await service.create("9", "55", { ...VALID_BODY, target_node_id: "" });
    expect(emptyNode.code).not.toBe(200);
    expect(emptyNode.msg).toContain("target_node_id");
    const extra = await service.create("9", "55", { ...VALID_BODY, extra: 1 });
    expect(extra.code).not.toBe(200);
    expect(extra.msg).toContain("不支持的参数");
  });
});

describe("VideoMattingsService.create：client_token 幂等键校验（≤64 可打印 ASCII、大小写敏感）", () => {
  it("rejects a missing client_token", async () => {
    const { service } = makeService();
    const body = { ...VALID_BODY };
    delete body.client_token;
    const result = await service.create("9", "55", body);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("client_token");
  });

  it("rejects a token longer than 64 chars or with non-printable / non-ASCII characters", async () => {
    const { service } = makeService();
    for (const clientToken of ["a".repeat(65), "tok\n001", "tok 001\u0000", "令牌"]) {
      const result = await service.create("9", "55", { ...VALID_BODY, client_token: clientToken });
      expect(result.code).not.toBe(200);
      expect(result.msg).toContain("client_token");
    }
  });

  it("looks the token up byte-exact (case-sensitive, no normalization)", async () => {
    const { service, tx } = makeService();
    await service.create("9", "55", { ...VALID_BODY, client_token: "Tok-001" });
    expect(tx.command_idempotency.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          project_id_operation_idempotency_key: expect.objectContaining({
            idempotency_key: "Tok-001",
            operation: "video_matting.create",
          }),
        }),
      }),
    );
  });
});

describe("VideoMattingsService.create：归属与媒体类型复核", () => {
  it("rejects an unknown project", async () => {
    const { service } = makeService({
      project: { findOwnedById: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects a source asset not owned by the user", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects a non-video asset with a readable reason", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeVideoAsset({ type: "image" })) },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("视频");
  });
});

describe("VideoMattingsService.create：输入门槛复核（时长 ≤10 分钟，缺失放行）", () => {
  it("rejects a video longer than 10 minutes with a readable reason", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(
          makeVideoAsset({ duration_ms: 10 * 60_000 + 1 }),
        ),
      },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("10 分钟");
  });

  it("accepts at the exact 10-minute boundary", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(
          makeVideoAsset({ duration_ms: 10 * 60_000 }),
        ),
      },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
  });

  it("lets a video without recorded duration pass to the supplier gate", async () => {
    // assets.duration_ms 由前端上报、存量大量为 null：缺权威值不臆造、不拦（前端缺失放行的
    // 后端兜底口径 = 有值才拦，无值放行交任务失败口径兜底）。
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeVideoAsset({ duration_ms: null })) },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
  });
});

describe("VideoMattingsService.create：client_token 幂等三态", () => {
  it("replays the first job for a same-token same-params retry without creating anything", async () => {
    const { service, tx } = makeService({
      idemFindUnique: vi.fn().mockResolvedValue({
        request_hash: hashFor("88", "node-1", "portrait", "WEBM", ""),
        generation_job_id: 400n,
      }),
      replayedJob: vi.fn().mockResolvedValue({ status: "queued" }),
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
    expect(result.data).toEqual({ job_id: "400", status: "queued" });
    // 重放不重复建任务：任务行与幂等行都零写入。
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
    expect(tx.command_idempotency.create).not.toHaveBeenCalled();
  });

  it("returns the job's current status on replay", async () => {
    const { service } = makeService({
      idemFindUnique: vi.fn().mockResolvedValue({
        request_hash: hashFor("88", "node-1", "portrait", "WEBM", ""),
        generation_job_id: 400n,
      }),
      replayedJob: vi.fn().mockResolvedValue({ status: "failed" }),
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
    expect(result.data).toEqual({ job_id: "400", status: "failed" });
  });

  it("rejects a same-token different-params retry as a conflict (100302)", async () => {
    const { service, tx } = makeService({
      idemFindUnique: vi.fn().mockResolvedValue({
        request_hash: hashFor("88", "node-1", "greenscreen", "MP4", "black"),
        generation_job_id: 400n,
      }),
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(100302);
    expect(result.msg).toContain("client_token");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });

  it("hashes the filled defaults: an omitted format replays against a frozen WEBM", async () => {
    const { service } = makeService({
      idemFindUnique: vi.fn().mockResolvedValue({
        // 首次提交未传 format（冻结 WEBM）；同 token 未传 format 重放 = 相同摘要可重放。
        request_hash: hashFor("88", "node-1", "portrait", "WEBM", ""),
        generation_job_id: 400n,
      }),
      replayedJob: vi.fn().mockResolvedValue({ status: "queued" }),
    });
    const body = { ...VALID_BODY };
    delete body.format;
    const result = await service.create("9", "55", body);
    expect(result.code).toBe(200);
    expect(result.data).toEqual({ job_id: "400", status: "queued" });
  });
});

describe("VideoMattingsService.create：任务与占位数据同事务落库", () => {
  it("creates the job and the idempotency row within one transaction", async () => {
    const { service, tx, client } = makeService();
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
    expect(result.data).toEqual({ job_id: "400", status: "queued" });
    // 同一事务（单次 $transaction 回调内完成两行写入——「无半创建状态」的载体）。
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.generation_jobs.create).toHaveBeenCalledTimes(1);
    expect(tx.command_idempotency.create).toHaveBeenCalledTimes(1);
    // 幂等行回指任务行，request_hash 摘要五业务键（WEBM 冻结无背景色位）。
    expect(tx.command_idempotency.create).toHaveBeenCalledWith({
      data: {
        project_id: 55n,
        operation: "video_matting.create",
        idempotency_key: "tok-001",
        request_hash: hashFor("88", "node-1", "portrait", "WEBM", ""),
        generation_job_id: 400n,
        accepted_cursor: 0n,
      },
    });
  });

  it("creates a video_matting job with the frozen five-key input (mode / format enum values, no upstream params)", async () => {
    const { service, tx } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_BODY,
      mode: "greenscreen",
      format: "MP4",
      background_color: "black",
    });
    expect(result.code).toBe(200);
    expect(tx.generation_jobs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "video_matting",
        source: "video_matting",
        status: "queued",
        user_id: 9n,
        project_id: 55n,
        input: {
          source_asset_id: "88",
          target_node_id: "node-1",
          mode: "greenscreen",
          format: "MP4",
          background_color: "black",
        },
        next_action_at: expect.any(Date),
      }),
    });
    // 模式 / 格式原样冻结为枚举值；worker 出站按 VIDEO_MATTING_SUBMIT_PATHS[mode] /
    // VIDEO_MATTING_MODEL_NAMES[mode] 换算，创建入口不落任何路径 / 模型名字面量。
    const input = tx.generation_jobs.create.mock.calls[0][0].data.input;
    expect(Object.keys(input)).not.toContain("model");
    expect(Object.keys(input)).not.toContain("provider_task_id");
  });

  it("is free-tier: no cost reservation", async () => {
    const { service, tx } = makeService();
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
    expect(tx.cost_reservations.create).not.toHaveBeenCalled();
  });
});

describe("VideoMattingsService.create：请求方凭证冻结（断链防护）", () => {
  // 断链背景：worker（IKHK99 按附录 C 注册的处理器）只从 input.provider_credential 取请求方 sk-，
  // 创建链路不冻结则必落 provider_credential_missing（先例：去字幕 / HD / 场景切分）。
  it("freezes the requester sk- token into job input (provider_credential)", async () => {
    const { service, tx } = makeService();
    const result = await service.create("9", "55", VALID_BODY, {
      providerCredential: "sk-live-token",
    });
    expect(result.code).toBe(200);
    expect(tx.generation_jobs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        input: {
          source_asset_id: "88",
          target_node_id: "node-1",
          mode: "portrait",
          format: "WEBM",
          provider_credential: "sk-live-token",
        },
      }),
    });
  });

  it("omits provider_credential when the requester carries no sk- token", async () => {
    const { service, tx } = makeService();
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
    expect(tx.generation_jobs.create.mock.calls[0][0].data.input).toEqual({
      source_asset_id: "88",
      target_node_id: "node-1",
      mode: "portrait",
      format: "WEBM",
    });
  });
});

describe("VideoMattingsService.create：恢复协议 v1 接入（IKJJQW）", () => {
  beforeEach(() => {
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

  it("accepts a canvas_binding submission when client_token equals submission_id", async () => {
    const { service, tx } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_BODY,
      client_token: SUBMISSION_ID,
      canvas_binding: CANVAS_BINDING,
    });
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({
      job_id: "400",
      status: "queued",
      canvas_binding: { submission_id: SUBMISSION_ID, binding_revision: 1, is_current: true },
    });
    // canvas_binding 剥离后不进冻结 input；幂等行 key=submission_id。
    expect(tx.generation_jobs.create.mock.calls[0][0].data.input).toEqual({
      source_asset_id: "88",
      target_node_id: "node-1",
      mode: "portrait",
      format: "WEBM",
    });
    expect(lockMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a canvas_binding whose submission_id differs from client_token", async () => {
    const { service, tx } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_BODY,
      canvas_binding: CANVAS_BINDING,
    });
    expect(result.code).toBe(400);
    expect(result.data).toMatchObject({ reason: "invalid_recovery_payload" });
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });

  it("returns the controlled conflict envelope without creating a job row", async () => {
    const { service, tx } = makeService();
    lockMock.mockRejectedValue(
      new RecoveryContractError({
        code: 409,
        msg: "目标节点承接版本已变化，请刷新后重试",
        data: { reason: "canvas_binding_conflict", currentBindingRevision: 2 },
      }),
    );
    const result = await service.create("9", "55", {
      ...VALID_BODY,
      client_token: SUBMISSION_ID,
      canvas_binding: CANVAS_BINDING,
    });
    expect(result.code).toBe(409);
    expect(result.data).toMatchObject({ reason: "canvas_binding_conflict", currentBindingRevision: 2 });
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });
});

/** 与服务同算法的请求摘要（重放/冲突用例的基准值）：sha256 定序拼接五业务键
 *  （background_color WEBM 冻结恒无键，空串占位）。 */
function hashFor(
  sourceAssetId: string,
  targetNodeId: string,
  mode: string,
  format: string,
  backgroundColor: string,
): string {
  return createHash("sha256")
    .update(
      `POST:/api/projects/55/video-mattings:${sourceAssetId}\0${targetNodeId}\0${mode}\0${format}\0${backgroundColor}`,
    )
    .digest("hex");
}
