import { describe, expect, it, vi } from "vitest";
import {
  agentAssetResolveRequestSchema,
  resolveAgentAsset,
  type AgentReadableAsset,
} from "./agent-asset-resolver.js";

const asset: AgentReadableAsset = {
  storage_key: "uploads/7/image/immutable.png",
  type: "image",
  mime: "image/png",
  size: 1_048_576n,
  duration_seconds: null,
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    findAccessible: vi.fn().mockResolvedValue(asset),
    sign: vi
      .fn()
      .mockImplementation(
        async (_key: string, options?: { forModelReading?: boolean }) => ({
          url: options?.forModelReading
            ? "https://assets.example.test/read?x-tos-process=resize&signature=secret"
            : "https://assets.example.test/read?signature=secret",
          expiresAt: new Date("2026-08-17T08:00:00.000Z"),
        }),
      ),
    ...overrides,
  };
}

describe("resolveAgentAsset", () => {
  it("rechecks the owner tuple and returns authoritative transient metadata", async () => {
    const current = deps();
    const outcome = await resolveAgentAsset(
      { asset_id: "123" },
      { userId: "7", projectId: "9" },
      current,
    );

    expect(current.findAccessible).toHaveBeenCalledWith("123", "7");
    expect(outcome).toEqual({
      kind: "ok",
      value: {
        asset_id: "123",
        media_type: "image",
        mime_type: "image/jpeg",
        size_bytes: 1_048_576,
        duration_seconds: null,
        read_url:
          "https://assets.example.test/read?x-tos-process=resize&signature=secret",
        probe_url: "https://assets.example.test/read?signature=secret",
        expires_at: "2026-08-17T08:00:00.000Z",
      },
    });
  });

  describe("给模型读的降采样版本", () => {
    it("图片带上 forModelReading，让存储适配器出降采样版", async () => {
      const current = deps();
      await resolveAgentAsset({ asset_id: "123" }, { userId: "7", projectId: "9" }, current);
      expect(current.sign).toHaveBeenCalledWith("uploads/7/image/immutable.png", {
        forModelReading: true,
      });
    });

    it("视频不降采样——图片处理参数对它不适用，且它走的是另一条理解链路", async () => {
      const current = deps({
        findAccessible: vi.fn().mockResolvedValue({
          ...asset,
          type: "video",
          mime: "video/mp4",
          storage_key: "uploads/7/video/clip.mp4",
          duration_seconds: 12,
        }),
      });
      const outcome = await resolveAgentAsset(
        { asset_id: "123" },
        { userId: "7", projectId: "9" },
        current,
      );

      expect(current.sign).toHaveBeenCalledWith("uploads/7/video/clip.mp4", {
        forModelReading: false,
      });
      expect(outcome).toMatchObject({ kind: "ok", value: { mime_type: "video/mp4" } });
    });

    it("SVG 绕开图片处理——TOS 处理它会挂死", async () => {
      const current = deps({
        findAccessible: vi.fn().mockResolvedValue({
          ...asset,
          mime: "image/svg+xml",
          storage_key: "uploads/7/image/logo.bin",
        }),
      });
      const outcome = await resolveAgentAsset(
        { asset_id: "123" },
        { userId: "7", projectId: "9" },
        current,
      );

      expect(current.sign).toHaveBeenCalledWith("uploads/7/image/logo.bin", {
        forModelReading: false,
      });
      expect(outcome).toMatchObject({ kind: "ok", value: { mime_type: "image/svg+xml" } });
    });
  });

  describe("探测读原始字节", () => {
    it("图片签两次：一条带处理参数给模型，一条不带给探测", async () => {
      const current = deps();
      const outcome = await resolveAgentAsset(
        { asset_id: "123" },
        { userId: "7", projectId: "9" },
        current,
      );

      expect(current.sign).toHaveBeenCalledTimes(2);
      expect(current.sign).toHaveBeenNthCalledWith(
        1,
        "uploads/7/image/immutable.png",
        { forModelReading: true },
      );
      expect(current.sign).toHaveBeenNthCalledWith(
        2,
        "uploads/7/image/immutable.png",
        { forModelReading: false },
      );
      const value = (outcome as { value: { read_url: string; probe_url: string } })
        .value;
      expect(value.read_url).toContain("x-tos-process");
      expect(value.probe_url).not.toContain("x-tos-process");
    });

    it("视频两条地址相同——它本来就不过图片处理，不必多签一次", async () => {
      const current = deps({
        findAccessible: vi.fn().mockResolvedValue({
          ...asset,
          type: "video",
          mime: "video/mp4",
          storage_key: "uploads/7/video/clip.mp4",
          duration_seconds: 12,
        }),
      });
      const outcome = await resolveAgentAsset(
        { asset_id: "123" },
        { userId: "7", projectId: "9" },
        current,
      );

      expect(current.sign).toHaveBeenCalledTimes(1);
      const value = (outcome as { value: { read_url: string; probe_url: string } })
        .value;
      expect(value.probe_url).toBe(value.read_url);
    });

    it("SVG 两条地址相同——它已经绕开了图片处理", async () => {
      const current = deps({
        findAccessible: vi.fn().mockResolvedValue({
          ...asset,
          mime: "image/svg+xml",
          storage_key: "uploads/7/image/logo.bin",
        }),
      });
      const outcome = await resolveAgentAsset(
        { asset_id: "123" },
        { userId: "7", projectId: "9" },
        current,
      );

      expect(current.sign).toHaveBeenCalledTimes(1);
      const value = (outcome as { value: { read_url: string; probe_url: string } })
        .value;
      expect(value.probe_url).toBe(value.read_url);
    });
  });

  it("rejects a request body that still carries the retired asset_version", () => {
    expect(
      agentAssetResolveRequestSchema.safeParse({
        asset_id: "123",
        asset_version: "av1_whatever",
      }).success,
    ).toBe(false);
    expect(agentAssetResolveRequestSchema.safeParse({ asset_id: "123" }).success).toBe(true);
  });

  it("resolves an Asset whose mutable metadata was backfilled after the Grant", async () => {
    const backfilled = { ...asset, duration_seconds: 12 };
    const current = deps({
      findAccessible: vi.fn().mockResolvedValue(backfilled),
    });
    const outcome = await resolveAgentAsset(
      { asset_id: "123" },
      { userId: "7", projectId: "9" },
      current,
    );

    expect(outcome).toMatchObject({
      kind: "ok",
      value: { asset_id: "123", duration_seconds: 12 },
    });
  });

  it("rejects missing trusted metadata without signing", async () => {
    const incomplete = { ...asset, size: null };
    const current = deps({
      findAccessible: vi.fn().mockResolvedValue(incomplete),
    });
    const outcome = await resolveAgentAsset(
      { asset_id: "123" },
      { userId: "7", projectId: "9" },
      current,
    );
    expect(outcome).toEqual({
      kind: "rejected",
      reason: "asset_metadata_unavailable",
    });
    expect(current.sign).not.toHaveBeenCalled();
  });

  it("rejects an Asset the owner tuple cannot reach, without signing", async () => {
    const current = deps({ findAccessible: vi.fn().mockResolvedValue(null) });
    await expect(
      resolveAgentAsset(
        { asset_id: "123" },
        { userId: "7", projectId: "9" },
        current,
      ),
    ).resolves.toEqual({ kind: "rejected", reason: "asset_inaccessible" });
    expect(current.sign).not.toHaveBeenCalled();
  });

  it("does not expose signer failures", async () => {
    const current = deps({
      sign: vi.fn().mockRejectedValue(new Error("secret upstream detail")),
    });
    await expect(
      resolveAgentAsset(
        { asset_id: "123" },
        { userId: "7", projectId: "9" },
        current,
      ),
    ).resolves.toEqual({
      kind: "rejected",
      reason: "storage_access_unavailable",
    });
  });
});
