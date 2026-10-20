import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const { enqueueVideoSceneSplitJob } = vi.hoisted(() => ({ enqueueVideoSceneSplitJob: vi.fn() }));
vi.mock("@lib/shared/generation/generation-queue.js", () => ({ enqueueVideoSceneSplitJob }));

import { VideoSceneSplitsService } from "./video-scene-splits.service.js";

const VALID_BODY = {
  source_asset_id: "88",
  target_node_id: "node-1",
  granularity: "standard",
  client_token: "tok-001",
};

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
  billing?: unknown;
  replayedJob?: unknown;
  storage?: unknown;
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
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ user_id: 9n }),
    },
    generation_outbox: { create: vi.fn() },
    cost_reservations: { create: vi.fn() },
  };
  const client = {
    assets: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    command_idempotency: {
      findUnique: overrides.idemFindUnique ?? vi.fn().mockResolvedValue(null),
    },
    generation_jobs: {
      findUnique: overrides.replayedJob ?? vi.fn(),
    },
    $transaction: vi.fn(async (operation: (t: unknown) => Promise<unknown>) => operation(tx)),
  };
  const prisma = { client };
  return {
    service: new VideoSceneSplitsService(prisma as never, project as never, assets as never, (overrides.storage ?? { probe: null }) as never, (overrides.billing ?? { jobBilling: async () => undefined, release: async () => {} }) as never),
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

  it("rejects a video without recorded duration", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeVideoAsset({ duration_ms: null })) },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(100202);
  });

  it("probes a legacy video and rejects when the probe exceeds 2 hours", async () => {
    const { service, tx } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeVideoAsset({ duration_ms: null })) },
      storage: {
        probe: vi.fn().mockResolvedValue({
          durationMs: 2 * 60 * 60 * 1000 + 1,
          width: 1920,
          height: 1080,
        }),
      },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("2 小时");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
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

  it("幂等预检异常时回落到事务内校验", async () => {
    const { service, client, tx } = makeService();
    client.command_idempotency.findUnique.mockRejectedValueOnce(new Error("corrupt row"));

    const result = await service.create("9", "55", VALID_BODY);

    expect(result.code).toBe(200);
    expect(tx.command_idempotency.create).toHaveBeenCalledTimes(1);
  });
});

describe("VideoSceneSplitsService.create：任务与占位数据同事务落库", () => {
  it("creates the job and the idempotency row within one transaction", async () => {
    const { service, tx, client } = makeService();
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
    expect(result.data).toEqual({ job_id: "400", status: "queued" });
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.generation_jobs.create).toHaveBeenCalledTimes(1);
    expect(tx.command_idempotency.create).toHaveBeenCalledTimes(1);
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
          duration: 600,
        },
        next_action_at: expect.any(Date),
      }),
    });
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
function hashFor(sourceAssetId: string, targetNodeId: string, granularity: string): string {
  return createHash("sha256")
    .update(
      `POST:/api/projects/55/video-scene-splits:${sourceAssetId}\0${targetNodeId}\0${granularity}`,
    )
    .digest("hex");
}

describe("VideoSceneSplitsService.create：计费输入", () => {
  it("按 video_scene_split 计价并入队", async () => {
    const jobBilling = vi.fn().mockResolvedValue(undefined);
    const { service } = makeService({ billing: { jobBilling, release: vi.fn() } });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
    expect(jobBilling).toHaveBeenCalledWith(
      "video_scene_split",
      "9",
      expect.objectContaining({ source_asset_id: "88", duration: 600 }),
    );
    expect(enqueueVideoSceneSplitJob).toHaveBeenCalledWith("400");
  });

  it("releases the charge when enqueue fails for a paid tool", async () => {
    const release = vi.fn();
    const { service } = makeService({
      billing: {
        jobBilling: vi.fn().mockResolvedValue({ charge: vi.fn(), release: vi.fn() }),
        release,
      },
    });
    enqueueVideoSceneSplitJob.mockRejectedValueOnce(new Error("rocketmq down"));

    const result = await service.create("9", "55", VALID_BODY);

    expect(result.code).toBe(200);
    expect(release).toHaveBeenCalledWith("9", 400, "任务入队失败");
  });

  it("does not release for a free tool when enqueue fails", async () => {
    const release = vi.fn();
    const { service } = makeService({
      billing: { jobBilling: vi.fn().mockResolvedValue(undefined), release },
    });
    enqueueVideoSceneSplitJob.mockRejectedValueOnce(new Error("rocketmq down"));

    const result = await service.create("9", "55", VALID_BODY);

    expect(result.code).toBe(200);
    expect(release).not.toHaveBeenCalled();
  });

  it("releases the charge when the transaction fails after the callback charged", async () => {
    const jobBillingRelease = vi.fn().mockResolvedValue(undefined);
    const { service, client, tx } = makeService({
      billing: {
        jobBilling: vi.fn().mockResolvedValue({ charge: vi.fn(), release: jobBillingRelease }),
        release: vi.fn(),
      },
    });
    client.$transaction.mockImplementationOnce(
      async (operation: (t: unknown) => Promise<unknown>) => {
        await operation(tx);
        throw new Error("commit failed");
      },
    );

    await expect(service.create("9", "55", VALID_BODY)).rejects.toThrow("commit failed");
    expect(jobBillingRelease).toHaveBeenCalledWith(400, "commit failed");
  });

  it("does not release a free tool when the transaction fails", async () => {
    const release = vi.fn();
    const { service, client, tx } = makeService({
      billing: { jobBilling: vi.fn().mockResolvedValue(undefined), release },
    });
    client.$transaction.mockImplementationOnce(
      async (operation: (t: unknown) => Promise<unknown>) => {
        await operation(tx);
        throw new Error("commit failed");
      },
    );

    await expect(service.create("9", "55", VALID_BODY)).rejects.toThrow("commit failed");
    expect(release).not.toHaveBeenCalled();
  });
});
