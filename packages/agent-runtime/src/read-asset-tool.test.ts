import { describe, expect, it, vi } from "vitest";

import {
  executeReadAssetTool,
  type ReadAssetToolContext,
  type ReadAssetTosConfig,
} from "./read-asset-tool.js";
import type { MentionInputSnapshot } from "@blue-whale/contracts";

const assetProjection = {
  asset_type: "image",
  mime: "image/png",
  size: "1024",
  width: 1200,
  height: 800,
  duration_ms: null,
  content_sha256: "a".repeat(64),
};

const snapshot: MentionInputSnapshot = {
  capability_snapshot_version: 1,
  entries: [
    {
      mention_id: "501",
      mention_seq: 0,
      type: "asset",
      availability: "available",
      reason: null,
      projection: assetProjection,
    },
    {
      mention_id: "502",
      mention_seq: 1,
      type: "scene_card",
      availability: "stale",
      reason: "stale",
      projection: {
        title: "开场分镜",
        summary: null,
        content_markdown: "# 开场",
        version: 3,
      },
    },
    {
      mention_id: "503",
      mention_seq: 2,
      type: "asset",
      availability: "unavailable",
      reason: "deleted",
    },
  ],
};

const tosConfig: ReadAssetTosConfig = {
  endpoint: "tos-cn-beijing.volces.com",
  bucket: "bw-test",
  region: "cn-beijing",
  ak: "AKIDEXAMPLE",
  sk: "secret",
  signedUrlTtlSeconds: 600,
};

function ctx(overrides: Partial<ReadAssetToolContext> = {}): ReadAssetToolContext {
  return {
    projectId: "42",
    userId: "100",
    resolveAssetTargetId: vi.fn().mockResolvedValue("777"),
    findAccessible: vi.fn().mockResolvedValue({
      storage_key: "private/mention/x.png",
      mime: "image/png",
    }),
    tosConfig,
    now: new Date("2026-08-04T00:00:00.000Z"),
    ...overrides,
  };
}

describe("executeReadAssetTool", () => {
  it("returns the authorized projection plus a short-lived presigned GET URL", async () => {
    const outcome = await executeReadAssetTool({ mention_id: "501" }, snapshot, ctx());
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.projection).toEqual(assetProjection);
    expect(outcome.presigned_url).toContain(
      "https://bw-test.tos-cn-beijing.volces.com/private/mention/x.png",
    );
    expect(outcome.presigned_url).toContain("X-Tos-Signature=");
    // 预签名 URL 含 AK ID（TOS SigV4 Credential 标准），但密钥本身绝不外泄（AC#3）。
    expect(outcome.presigned_url).not.toContain("secret");
    expect(JSON.stringify(outcome.projection)).not.toContain("storage_key");
  });

  it("rejects a mention identity outside the round snapshot (AC#4)", async () => {
    const outcome = await executeReadAssetTool({ mention_id: "9999" }, snapshot, ctx());
    expect(outcome).toEqual({ kind: "rejected", reason: "mention_not_in_snapshot" });
  });

  it("rejects a scene_card mention (read_asset is asset-only)", async () => {
    const outcome = await executeReadAssetTool({ mention_id: "502" }, snapshot, ctx());
    expect(outcome).toEqual({ kind: "rejected", reason: "mention_not_asset" });
  });

  it("rejects an unavailable asset mention", async () => {
    const outcome = await executeReadAssetTool({ mention_id: "503" }, snapshot, ctx());
    expect(outcome).toEqual({ kind: "rejected", reason: "mention_unavailable" });
  });

  it("rejects when the asset target can no longer be resolved", async () => {
    const outcome = await executeReadAssetTool(
      { mention_id: "501" },
      snapshot,
      ctx({ resolveAssetTargetId: vi.fn().mockResolvedValue(null) }),
    );
    expect(outcome).toEqual({ kind: "rejected", reason: "asset_target_unresolved" });
  });

  it("rejects when real-time accessibility recheck fails (revoked after freeze)", async () => {
    const outcome = await executeReadAssetTool(
      { mention_id: "501" },
      snapshot,
      ctx({ findAccessible: vi.fn().mockResolvedValue(null) }),
    );
    expect(outcome).toEqual({ kind: "rejected", reason: "asset_inaccessible" });
  });

  it("rejects when the asset has no storage_key", async () => {
    const outcome = await executeReadAssetTool(
      { mention_id: "501" },
      snapshot,
      ctx({
        findAccessible: vi.fn().mockResolvedValue({ storage_key: null, mime: null }),
      }),
    );
    expect(outcome).toEqual({ kind: "rejected", reason: "storage_key_missing" });
  });

  it("rejects when TOS storage access is unconfigured", async () => {
    const outcome = await executeReadAssetTool(
      { mention_id: "501" },
      snapshot,
      ctx({ tosConfig: null }),
    );
    expect(outcome).toEqual({ kind: "rejected", reason: "storage_access_unconfigured" });
  });

  it("never queries storage by a raw asset id supplied by the model (AC#4)", async () => {
    const resolve = vi.fn().mockResolvedValue("777");
    const findAccessible = vi.fn().mockResolvedValue({
      storage_key: "private/mention/x.png",
      mime: "image/png",
    });
    await executeReadAssetTool(
      { mention_id: "501" },
      snapshot,
      ctx({ resolveAssetTargetId: resolve, findAccessible }),
    );
    // findAccessible 的 assetId 入参来自内部 target 解析（"777"），而非模型输入。
    expect(findAccessible).toHaveBeenCalledWith("42", "777", "100");
    expect(findAccessible).not.toHaveBeenCalledWith(
      "42",
      expect.not.stringContaining("777"),
      "100",
    );
  });
});
