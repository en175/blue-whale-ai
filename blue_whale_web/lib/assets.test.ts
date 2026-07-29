import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "./api";
import { completeAsset, presignAsset } from "./api/endpoints";
import { copyAssetToProject, deleteAsset, uploadAsset } from "./assets";

vi.mock("./api", () => ({ request: vi.fn() }));
vi.mock("./api/endpoints", () => ({
  presignAsset: vi.fn(),
  completeAsset: vi.fn(),
}));
import { readLocalMediaMetadata } from "./mediaSize";
vi.mock("./mediaSize", () => ({
  detectMediaKind: vi.fn(() => "image"),
  readLocalMediaMetadata: vi.fn(),
}));

describe("Assets API", () => {
  beforeEach(() => {
    vi.mocked(request).mockReset();
    vi.mocked(presignAsset).mockReset();
    vi.mocked(completeAsset).mockReset();
    vi.mocked(readLocalMediaMetadata).mockReset();
  });

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

  it("视频上传 complete 携带浏览器读取的宽高和时长", async () => {
    vi.mocked(presignAsset).mockResolvedValue({
      storage_key: "uploads/9/video/reference.mp4",
      upload_url: "https://upload.test/reference.mp4",
      headers: { "Content-Type": "video/mp4" },
      expires_in: 600,
    });
    vi.mocked(readLocalMediaMetadata).mockResolvedValue({
      width: 1920,
      height: 1080,
      duration: 6.5,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    vi.mocked(completeAsset).mockResolvedValue({
      asset_id: "42",
      status: "ready",
      type: "video",
      url: "https://tos.test/reference.mp4",
      width: 1920,
      height: 1080,
      duration: 6.5,
      mime: "video/mp4",
      size: 5,
    });
    const file = new File(["video"], "reference.mp4", {
      type: "video/mp4",
    });

    await uploadAsset(file, 55, "video");

    expect(completeAsset).toHaveBeenCalledWith({
      project_id: "55",
      type: "video",
      mime: "video/mp4",
      size: file.size,
      storage_key: "uploads/9/video/reference.mp4",
      width: 1920,
      height: 1080,
      duration: 6.5,
    });
  });

  it("空 MIME 的 MOV 按扩展名使用 video/quicktime", async () => {
    vi.mocked(presignAsset).mockResolvedValue({
      storage_key: "uploads/9/video/reference.mov",
      upload_url: "https://upload.test/reference.mov",
      headers: { "Content-Type": "video/quicktime" },
      expires_in: 600,
    });
    vi.mocked(readLocalMediaMetadata).mockResolvedValue({
      width: 1280,
      height: 720,
      duration: 3,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );
    vi.mocked(completeAsset).mockResolvedValue({
      asset_id: "43",
      status: "ready",
      type: "video",
      url: "https://tos.test/reference.mov",
      width: 1280,
      height: 720,
      duration: 3,
      mime: "video/quicktime",
      size: 5,
    });

    await uploadAsset(
      new File(["video"], "reference.MOV", { type: "" }),
      55,
      "video",
    );

    expect(presignAsset).toHaveBeenCalledWith(
      expect.objectContaining({ mime: "video/quicktime" }),
    );
    expect(completeAsset).toHaveBeenCalledWith(
      expect.objectContaining({ mime: "video/quicktime" }),
    );
  });
});
