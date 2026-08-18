import { describe, expect, it, vi } from "vitest";
import {
  deriveAssetContentVersion,
  resolveAgentAsset,
  type AgentReadableAsset,
} from "./agent-asset-resolver.js";

const asset: AgentReadableAsset = {
  storage_key: "uploads/7/image/immutable.png",
  content_sha256: "a".repeat(64),
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
      {
        asset_id: "123",
        asset_version: deriveAssetContentVersion(asset),
      },
      { userId: "7", projectId: "9" },
      current,
    );

    expect(current.findAccessible).toHaveBeenCalledWith("9", "123", "7");
    expect(outcome).toEqual({
      kind: "ok",
      value: {
        asset_id: "123",
        asset_version: deriveAssetContentVersion(asset),
        media_type: "image",
        mime_type: "image/png",
        size_bytes: 1_048_576,
        duration_seconds: null,
        read_url: "https://assets.example.test/read?signature=secret",
        expires_at: "2026-08-17T08:00:00.000Z",
      },
    });
  });

  it("rejects a stale content version before issuing a read capability", async () => {
    const current = deps();
    await expect(
      resolveAgentAsset(
        { asset_id: "123", asset_version: "av1_stale" },
        { userId: "7", projectId: "9" },
        current,
      ),
    ).resolves.toEqual({
      kind: "rejected",
      reason: "asset_version_mismatch",
    });
    expect(current.sign).not.toHaveBeenCalled();
  });

  it("rejects missing trusted metadata without signing", async () => {
    const incomplete = { ...asset, size: null };
    const current = deps({
      findAccessible: vi.fn().mockResolvedValue(incomplete),
    });
    const outcome = await resolveAgentAsset(
      {
        asset_id: "123",
        asset_version: deriveAssetContentVersion(incomplete),
      },
      { userId: "7", projectId: "9" },
      current,
    );
    expect(outcome).toEqual({
      kind: "rejected",
      reason: "asset_metadata_unavailable",
    });
    expect(current.sign).not.toHaveBeenCalled();
  });

  it("does not expose signer failures", async () => {
    const current = deps({
      sign: vi.fn().mockRejectedValue(new Error("secret upstream detail")),
    });
    await expect(
      resolveAgentAsset(
        {
          asset_id: "123",
          asset_version: deriveAssetContentVersion(asset),
        },
        { userId: "7", projectId: "9" },
        current,
      ),
    ).resolves.toEqual({
      kind: "rejected",
      reason: "storage_access_unavailable",
    });
  });
});
