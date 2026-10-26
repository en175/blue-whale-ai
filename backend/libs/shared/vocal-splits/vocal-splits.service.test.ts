import { describe, expect, it, vi } from "vitest";
import { RECOVERY_REASONS } from "@lib/contracts";

const { enqueueVocalSplitJob } = vi.hoisted(() => ({ enqueueVocalSplitJob: vi.fn() }));
vi.mock("@lib/shared/generation/generation-queue.js", () => ({ enqueueVocalSplitJob }));

import { VocalSplitsService } from "./vocal-splits.service.js";

function makeService(overrides: {
  project?: unknown;
  assets?: unknown;
  createJob?: unknown;
} = {}) {
  const project = overrides.project ?? { findOwnedById: vi.fn().mockResolvedValue({ id: 55n }) };
  const assets =
    overrides.assets ??
    {
      findOwnedSource: vi.fn().mockResolvedValue({ id: 88n, type: "video", duration_ms: 61_000 }),
    };
  const create = overrides.createJob ?? vi.fn().mockResolvedValue({ id: 400n });
  const costCreate = vi.fn();
  const transaction = vi.fn();
  const prisma = {
    client: {
      $transaction: transaction,
      generation_jobs: { create },
      cost_reservations: { create: costCreate },
    },
  };
  const jobBilling = vi.fn().mockResolvedValue(undefined);
  return {
    service: new VocalSplitsService(
      prisma as never,
      project as never,
      assets as never,
      { probe: null } as never,
      { jobBilling, release: vi.fn() } as never,
    ),
    create,
    costCreate,
    transaction,
    jobBilling,
  };
}

describe("VocalSplitsService.create：参数校验", () => {
  const canvasBinding = {
    protocol_version: 1,
    submission_id: "1a2b3c4d-0000-4000-8000-00000000a001",
    target_node_id: "vocal-node-1",
    expected_binding_revision: 0,
    recovery_seed: {
      target: { role: "result-placeholder", x: 0, y: 0, width: 100, height: 100, name: "" },
      sources: [],
    },
  };

  describe.each([false, true])("畸形幂等键，画布绑定=%s", (bound) => {
    it.each([
      { label: "数字", key: 42 },
      { label: "布尔值", key: true },
      { label: "对象", key: {} },
      { label: "数组", key: [] },
      { label: "null", key: null },
    ])("返回业务 400，键=$label", async ({ key }) => {
      const { service, create, transaction } = makeService();
      await expect(Reflect.apply(service.create, service, [
        "9", "55", { source_asset_id: "88", canvas_binding: bound ? canvasBinding : undefined }, key,
      ])).resolves.toMatchObject({
        code: 400,
        data: { reason: RECOVERY_REASONS.invalidPayload },
      });
      expect(create).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });
  });

  it.each([undefined, "", " \t ", "1a2b3c4d-0000-4000-8000-00000000b002"])(
    "有绑定时拒绝缺失、空白或不匹配的幂等键（%s）",
    async (idempotencyKey) => {
      const { service, create, transaction } = makeService();
      const result = await service.create("9", "55", {
        source_asset_id: "88", canvas_binding: canvasBinding,
      }, idempotencyKey);
      expect(result).toMatchObject({
        code: 400,
        data: { reason: RECOVERY_REASONS.invalidPayload },
      });
      expect(create).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it("rejects a missing source_asset_id", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", {});
    expect(result.code).not.toBe(200);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric source_asset_id (contract schema)", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", { source_asset_id: "abc" });
    expect(result.code).not.toBe(200);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an unknown project", async () => {
    const { service } = makeService({
      project: { findOwnedById: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).not.toBe(200);
  });

  it("rejects a source asset not owned by the user", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).not.toBe(200);
  });

  it("rejects an image asset (only video/audio sources)", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue({ id: 88n, type: "image" }) },
    });
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("视频或音频");
  });

  it.each(["Audio", "music1", "", null, 42, {}])(
    "rejects a scene outside the contract enum (%s)",
    async (scene) => {
      const { service, create } = makeService();
      const result = await service.create("9", "55", {
        source_asset_id: "88",
        scene,
      });
      expect(result.code).not.toBe(200);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it.each(["ogg", "MP3", "", null, 42, {}])(
    "rejects an output_format outside the contract enum (%s)",
    async (outputFormat) => {
      const { service, create } = makeService();
      const result = await service.create("9", "55", {
        source_asset_id: "88",
        output_format: outputFormat,
      });
      expect(result.code).not.toBe(200);
      expect(create).not.toHaveBeenCalled();
    },
  );
});

describe("VocalSplitsService.create：缺省补默认与建单", () => {
  it("defaults scene to audio and output_format to aac when omitted", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).toBe(200);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        input: { source_asset_id: "88", scene: "audio", output_format: "aac", duration: 61 },
      }),
    });
  });

  it.each(["aac", "mp3", "wav", "m4a", "flac"])(
    "accepts every contract output_format enum value (%s)",
    async (outputFormat) => {
      const { service, create } = makeService();
      const result = await service.create("9", "55", {
        source_asset_id: "88",
        output_format: outputFormat,
      });
      expect(result.code).toBe(200);
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          input: { source_asset_id: "88", scene: "audio", output_format: outputFormat, duration: 61 },
        }),
      });
    },
  );

  it.each(["audio", "music", "drama", "narrate"] as const)(
    "freezes scene %s into input（轨数由 Worker 按 scene 自推）",
    async (scene) => {
      const { service, create } = makeService();
      const result = await service.create("9", "55", {
        source_asset_id: "88",
        scene,
      });
      expect(result.code).toBe(200);
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          input: { source_asset_id: "88", scene, output_format: "aac", duration: 61 },
        }),
      });
    },
  );

  it("creates a vocal_split job and returns the job id", async () => {
    const { service, create, jobBilling } = makeService();
    const result = await service.create("9", "55", {
      source_asset_id: "88",
      scene: "drama",
      output_format: "flac",
    });
    expect(result.code).toBe(200);
    expect(jobBilling).toHaveBeenCalledWith("vocal_split", "9", expect.objectContaining({ duration: 61 }));
    expect(result.data).toMatchObject({ job_id: "400", status: "queued" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "vocal_split",
        source: "vocal_split",
        status: "queued",
        progress: 0,
        user_id: 9n,
        project_id: 55n,
        input: { source_asset_id: "88", scene: "drama", output_format: "flac", duration: 61 },
        next_action_at: expect.any(Date),
      }),
    });
  });

  it("is free-tier: no cost reservation, no provider row", async () => {
    const { service, create, costCreate } = makeService();
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).toBe(200);
    expect(costCreate).not.toHaveBeenCalled();
    const data = create.mock.calls[0][0].data;
    expect(Object.keys(data)).not.toContain("provider");
  });
});
