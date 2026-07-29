import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/** 最小 XHR 假实现：捕获实例供测试驱动 upload.onprogress/onload/onerror。 */
class FakeXHR {
  static instances: FakeXHR[] = [];
  upload: {
    onprogress:
      | ((e: {
          lengthComputable: boolean;
          loaded: number;
          total: number;
        }) => void)
      | null;
  } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  constructor() {
    FakeXHR.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
}

const presignDto = {
  storage_key: "uploads/9/image/cat.png",
  upload_url: "https://tos.test/upload",
  headers: { "Content-Type": "image/png" },
  expires_in: 600,
};
const completeDto: import("./api/dto").AssetResponse = {
  asset_id: "91",
  status: "ready",
  type: "image",
  url: "https://assets.test/cat.png",
  width: 0,
  height: 0,
  duration: null,
  mime: "image/png",
  size: 1,
};

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

describe("uploadAsset / onProgress（XHR PUT）", () => {
  beforeEach(() => {
    vi.mocked(presignAsset).mockResolvedValue(presignDto);
    vi.mocked(completeAsset).mockResolvedValue(completeDto);
    FakeXHR.instances = [];
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("传入 onProgress 时 PUT 走 XHR（不发 fetch），进度按百分比回报", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onProgress = vi.fn();
    const file = new File(["x"], "cat.png", { type: "image/png" });

    const pending = uploadAsset(file, undefined, undefined, onProgress);
    // presign 是异步的，先让出微任务等 XHR 创建
    await vi.waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    const xhr = FakeXHR.instances[0];

    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe("https://tos.test/upload");
    expect(xhr.headers).toEqual({ "Content-Type": "image/png" });
    expect(xhr.body).toBe(file);

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 200 });
    expect(onProgress).toHaveBeenCalledWith(25);

    xhr.status = 200;
    xhr.onload?.();
    await expect(pending).resolves.toEqual({
      id: "91",
      url: "https://assets.test/cat.png",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("XHR PUT 返回非 2xx 时按状态码 reject", async () => {
    const onProgress = vi.fn();
    const file = new File(["x"], "cat.png", { type: "image/png" });

    const pending = uploadAsset(file, undefined, undefined, onProgress);
    await vi.waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    const xhr = FakeXHR.instances[0];

    xhr.status = 500;
    xhr.onload?.();
    await expect(pending).rejects.toThrow("上传失败: 500");
  });

  it("XHR 网络错误 reject", async () => {
    const file = new File(["x"], "cat.png", { type: "image/png" });

    const pending = uploadAsset(file, undefined, undefined, vi.fn());
    await vi.waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    const xhr = FakeXHR.instances[0];

    xhr.onerror?.();
    await expect(pending).rejects.toThrow();
  });

  it("不传 onProgress 时保持 fetch 原路径", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["x"], "cat.png", { type: "image/png" });

    await expect(uploadAsset(file)).resolves.toEqual({
      id: "91",
      url: "https://assets.test/cat.png",
    });

    expect(fetchMock).toHaveBeenCalledWith("https://tos.test/upload", {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: file,
    });
    expect(FakeXHR.instances).toHaveLength(0);
  });
});
