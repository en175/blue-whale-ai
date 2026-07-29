import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "./api";
import { completeAsset, presignAsset } from "./api/endpoints";
import { copyAssetToProject, deleteAsset, uploadAsset } from "./assets";

vi.mock("./api", () => ({ request: vi.fn() }));
vi.mock("./api/endpoints", () => ({
  presignAsset: vi.fn(),
  completeAsset: vi.fn(),
}));

describe("Assets API", () => {
  beforeEach(() => vi.mocked(request).mockReset());

  it("添加到项目：POST /api/projects/{id}/assets 携带 source_asset_id 与 Idempotency-Key", async () => {
    vi.mocked(request).mockResolvedValue({
      id: 101,
      type: "image",
      url: "/assets/101/content",
      width: 1024,
      height: 1024,
      duration: null,
      source: "generated",
      created_at: "2026-07-19T10:00:00Z",
    });

    const result = await copyAssetToProject(77, 9, "cmd-1");

    expect(request).toHaveBeenCalledWith(
      "/projects/77/assets",
      "POST",
      { source_asset_id: 9 },
      { "Idempotency-Key": "cmd-1" },
    );
    expect(result.id).toBe(101);
  });

  it("全局素材上传 complete 不发送 project_id", async () => {
    vi.mocked(presignAsset).mockResolvedValue({
      storage_key: "uploads/9/image/cat.png",
      upload_url: "https://tos.test/upload",
      headers: { "Content-Type": "image/png" },
      expires_in: 600,
    });
    vi.mocked(completeAsset).mockResolvedValue({
      asset_id: "91",
      status: "ready",
      type: "image",
      url: "https://assets.test/cat.png",
      width: 0,
      height: 0,
      duration: null,
      mime: "image/png",
      size: 1,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const file = new File(["x"], "cat.png", { type: "image/png" });

    await expect(uploadAsset(file)).resolves.toEqual({
      id: "91",
      url: "https://assets.test/cat.png",
    });

    expect(completeAsset).toHaveBeenCalledWith({
      type: "image",
      mime: "image/png",
      size: 1,
      storage_key: "uploads/9/image/cat.png",
    });
  });

  it("删除全局素材：DELETE /api/assets/{id}", async () => {
    vi.mocked(request).mockResolvedValue(undefined);

    await deleteAsset(42);

    expect(request).toHaveBeenCalledWith("/assets/42", "DELETE");
  });
});
