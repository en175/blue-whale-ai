// IKH8BO：视频场景切分创建入口复核矩阵与幂等/同事务落库单测（先例：
// video-enhancements.service.test.ts + storyboard-preview-repo 的幂等三态口径）。
// 只测外部可见行为：拒绝原因可读、client_token 幂等三态（重放/冲突/新建）、任务行与幂等行
// 同事务原子落库、落库参数冻结（粒度档原样冻结不译数值）、免费口径无成本预留、凭证冻结。
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { VideoSceneSplitsService } from "./video-scene-splits.service.js";

const VALID_BODY = {
  source_asset_id: "88",
  target_node_id: "node-1",
  granularity: "standard",
  client_token: "tok-001",
};

/** 默认源素材：1920x1080 mp4、10 分钟；时长权威值齐备且在门槛内。 */
function makeVideoAsset(overrides: Record<string, unknown> = {}) {
  return {
    type: "video",
    url: "https://tos.example.com/uploads/9/video/a.mp4",
    storage_key: "uploads/9/video/a.mp4",
    mime: "video/mp4",
    width: 1920,
    height: 1080,
    duration_ms: 10 * 60_000,
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
  const client = { $transaction: vi.fn(async (operation: (t: unknown) => Promise<unknown>) => operation(tx)) };
  const prisma = { client };
  return {
    service: new VideoSceneSplitsService(prisma as never, project as never, assets as never),
    tx,
    client,
    project,
    assets,
  };
}

describe("VideoSceneSplitsService.create：契约 schema 复核", () => {
  it("rejects a missing source_asset_id", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, source_asset_id: undefined });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("source_asset_id");
  });

  it("rejects an empty target_node_id", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, target_node_id: "" });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("target_node_id");
  });

  it("rejects an unknown granularity with a readable reason", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, granularity: "ultra" });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("切分粒度");
  });

  it("rejects a non-numeric asset id", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, source_asset_id: "08x" });
    expect(result.code).not.toBe(200);
  });

  it("rejects an extra key", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, extra: 1 });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("不支持的参数");
  });

  it("accepts all three granularities", async () => {
    const { service } = makeService();
    for (const granularity of ["fine", "standard", "coarse"]) {
      const result = await service.create("9", "55", { ...VALID_BODY, granularity });
      expect(result.code).toBe(200);
    }
  });
});

describe("VideoSceneSplitsService.create：client_token 幂等键校验（≤64 可打印 ASCII、大小写敏感）", () => {
  it("rejects a missing client_token", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      source_asset_id: "88",
      target_node_id: "node-1",
      granularity: "standard",
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("client_token");
  });

  it("rejects a token longer than 64 chars", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, client_token: "a".repeat(65) });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("client_token");
  });

  it("rejects a token with non-printable or non-ASCII characters", async () => {
    const { service } = makeService();
    for (const clientToken of ["tok\n001", "tok 001\u0000", "令牌"]) {
      const result = await service.create("9", "55", { ...VALID_BODY, client_token: clientToken });
      expect(result.code).not.toBe(200);
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
            operation: "video_scene_split.create",
          }),
        }),
      }),
    );
  });
});

describe("VideoSceneSplitsService.create：归属与媒体类型复核", () => {
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

describe("VideoSceneSplitsService.create：输入门槛复核（时长 ≤2 小时，缺失放行）", () => {
  it("rejects a video longer than 2 hours with a readable reason", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(
          makeVideoAsset({ duration_ms: 2 * 60 * 60 * 1000 + 1 }),
        ),
      },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("2 小时");
  });

  it("accepts at the exact 2-hour boundary", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(
          makeVideoAsset({ duration_ms: 2 * 60 * 60 * 1000 }),
        ),
      },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
  });

  it("lets a video without recorded duration pass to the supplier gate", async () => {
    // assets.duration_ms 由前端上报、存量大量为 null：缺权威值不臆造、不拦（规格故事 4，
    // 后端按权威数据复核——有值才拦，无值放行交任务失败口径兜底）。
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeVideoAsset({ duration_ms: null })) },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
  });
});

describe("VideoSceneSplitsService.create：client_token 幂等三态", () => {
  it("replays the first job for a same-token same-params retry without creating anything", async () => {
    const { service, tx } = makeService({
      idemFindUnique: vi.fn().mockResolvedValue({
        request_hash: hashFor("88", "node-1", "standard"),
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
        request_hash: hashFor("88", "node-1", "standard"),
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
        request_hash: hashFor("88", "node-1", "fine"),
        generation_job_id: 400n,
      }),
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(100302);
    expect(result.msg).toContain("client_token");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });
});

describe("VideoSceneSplitsService.create：任务与占位数据同事务落库", () => {
  it("creates the job and the idempotency row within one transaction", async () => {
    const { service, tx, client } = makeService();
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
    expect(result.data).toEqual({ job_id: "400", status: "queued" });
    // 同一事务（单次 $transaction 回调内完成两行写入——「无半创建状态」的载体）。
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.generation_jobs.create).toHaveBeenCalledTimes(1);
    expect(tx.command_idempotency.create).toHaveBeenCalledTimes(1);
    // 幂等行回指任务行，request_hash 摘要三业务键。
    expect(tx.command_idempotency.create).toHaveBeenCalledWith({
      data: {
        project_id: 55n,
        operation: "video_scene_split.create",
        idempotency_key: "tok-001",
        request_hash: hashFor("88", "node-1", "standard"),
        generation_job_id: 400n,
        accepted_cursor: 0n,
      },
    });
  });

  it("creates a video_scene_split job with the frozen three-key input (granularity stays the enum, thresholds are not duplicated here)", async () => {
    const { service, tx } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, granularity: "fine" });
    expect(result.code).toBe(200);
    expect(tx.generation_jobs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "video_scene_split",
        source: "video_scene_split",
        status: "queued",
        user_id: 9n,
        project_id: 55n,
        input: {
          source_asset_id: "88",
          target_node_id: "node-1",
          granularity: "fine",
        },
        next_action_at: expect.any(Date),
      }),
    });
    // 粒度档原样冻结为枚举值；segment_threshold 数值翻译单源在契约映射表（worker 出站处
    // 换算），创建入口不落任何 threshold 数值键。
    const input = tx.generation_jobs.create.mock.calls[0][0].data.input;
    expect(Object.keys(input)).not.toContain("segment_threshold");
    expect(input.granularity).toBe("fine");
  });

  it("is free-tier: no cost reservation", async () => {
    const { service, tx } = makeService();
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
    expect(tx.cost_reservations.create).not.toHaveBeenCalled();
  });
});
/** 与服务同算法的请求摘要（重放/冲突用例的基准值）：sha256 定序拼接三业务键。 */
function hashFor(sourceAssetId: string, targetNodeId: string, granularity: string): string {
  return createHash("sha256")
    .update(
      `POST:/api/projects/55/video-scene-splits:${sourceAssetId}\0${targetNodeId}\0${granularity}`,
    )
    .digest("hex");
}
