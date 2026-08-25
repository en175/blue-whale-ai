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
    sign: vi.fn().mockResolvedValue({
      url: "https://assets.example.test/read?signature=secret",
      expiresAt: new Date("2026-08-17T08:00:00.000Z"),
    }),
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

    expect(current.findAccessible).toHaveBeenCalledWith("9", "123", "7");
    expect(outcome).toEqual({
      kind: "ok",
      value: {
        asset_id: "123",
        media_type: "image",
        mime_type: "image/png",
        size_bytes: 1_048_576,
        duration_seconds: null,
        read_url: "https://assets.example.test/read?signature=secret",
        expires_at: "2026-08-17T08:00:00.000Z",
      },
    });
  });

  it("rejects a request body that still carries the retired asset_version", () => {
    // 内容版本已整体撤除（IKASSI），两侧同轮完成：Agent 不再发送，这里也不再接受。schema 保持
    // `.strict()`，多余字段意味着调用方与契约不一致，此时在入口报错比静默忽略更早暴露问题。
    expect(
      agentAssetResolveRequestSchema.safeParse({
        asset_id: "123",
        asset_version: "av1_whatever",
      }).success,
    ).toBe(false);
    expect(agentAssetResolveRequestSchema.safeParse({ asset_id: "123" }).success).toBe(true);
  });

  it("resolves an Asset whose mutable metadata was backfilled after the Grant", async () => {
    // 这一条正是撤除内容版本校验的理由（IKASSI）。此前 duration_seconds 参与指纹派生，而上传
    // 时它是可选写入的：一次补时长的后台任务就会让指纹整体改变，此后所有历史 Grant 一律
    // 指纹失配，用户看到的是「资源不存在」——素材明明在。现在回填不再影响解析。
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
    // 归属校验是撤除版本校验之后仅存的那道门，必须有测试锁住它没被一并削弱。
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
