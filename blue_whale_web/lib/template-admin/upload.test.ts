import { describe, expect, it, vi } from "vitest";

import { logTemplateUpload } from "./operation-log";
import {
  handleCompleteTemplateUpload,
  handlePresignTemplateUpload,
  TEMPLATE_UPLOAD_KEY_PREFIX,
} from "./upload";

vi.mock("./operation-log", () => ({
  logTemplateUpload: vi.fn(),
}));

function makeDeps() {
  return {
    storage: {
      prepareUpload: vi.fn(),
      inspectObject: vi.fn(),
      makePublic: vi.fn(),
    },
  };
}

const VALID_IMAGE = { type: "image", mime: "image/jpeg", size: 1024 };
const VALID_VIDEO = { type: "video", mime: "video/mp4", size: 2048 };

describe("handlePresignTemplateUpload", () => {
  it("合法图片 → 签发 PUT 契约，对象 key 前缀 admin/templates/image/", async () => {
    const deps = makeDeps();
    deps.storage.prepareUpload.mockResolvedValue({
      storageKey: "admin/templates/image/abc123.jpg",
      publicUrl: "https://bucket.tos.test/admin/templates/image/abc123.jpg",
      uploadUrl: "https://bucket.tos.test/upload-signed",
      headers: { "Content-Type": "image/jpeg" },
      expiresIn: 600,
    });

    const result = await handlePresignTemplateUpload(VALID_IMAGE, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.data.storage_key.startsWith(
        `${TEMPLATE_UPLOAD_KEY_PREFIX}/image/`,
      ),
    ).toBe(true);
    expect(result.data.upload_url).toBe(
      "https://bucket.tos.test/upload-signed",
    );
    expect(result.data.headers).toEqual({ "Content-Type": "image/jpeg" });
    expect(result.data.expires_in).toBe(600);
    expect(deps.storage.prepareUpload).toHaveBeenCalledWith(
      expect.objectContaining({ keyPrefix: TEMPLATE_UPLOAD_KEY_PREFIX }),
    );
  });

  it("合法 mp4 视频 → 放行", async () => {
    const deps = makeDeps();
    deps.storage.prepareUpload.mockResolvedValue({
      storageKey: "admin/templates/video/def456.mp4",
      publicUrl: "https://bucket.tos.test/admin/templates/video/def456.mp4",
      uploadUrl: "https://bucket.tos.test/upload-signed",
      headers: { "Content-Type": "video/mp4" },
      expiresIn: 600,
    });

    const result = await handlePresignTemplateUpload(VALID_VIDEO, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.data.storage_key.startsWith(
        `${TEMPLATE_UPLOAD_KEY_PREFIX}/video/`,
      ),
    ).toBe(true);
  });

  it("拒绝非图片/视频类型（audio）", async () => {
    const deps = makeDeps();

    const result = await handlePresignTemplateUpload(
      { type: "audio", mime: "audio/mpeg", size: 1024 },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("图片或视频");
    expect(deps.storage.prepareUpload).not.toHaveBeenCalled();
  });

  it("拒绝模板不支持的视频格式（webm/mov）", async () => {
    const deps = makeDeps();

    const webm = await handlePresignTemplateUpload(
      { type: "video", mime: "video/webm", size: 1024 },
      deps,
    );
    const mov = await handlePresignTemplateUpload(
      { type: "video", mime: "video/quicktime", size: 1024 },
      deps,
    );

    expect(webm.ok).toBe(false);
    expect(mov.ok).toBe(false);
    expect(deps.storage.prepareUpload).not.toHaveBeenCalled();
  });

  it("拒绝超限图片（>20MB）与超限视频（>200MB）", async () => {
    const deps = makeDeps();

    const bigImage = await handlePresignTemplateUpload(
      { type: "image", mime: "image/png", size: 20 * 1024 * 1024 + 1 },
      deps,
    );
    const bigVideo = await handlePresignTemplateUpload(
      { type: "video", mime: "video/mp4", size: 200 * 1024 * 1024 + 1 },
      deps,
    );

    expect(bigImage.ok).toBe(false);
    expect(bigVideo.ok).toBe(false);
  });

  it("拒绝非法 size（0 / 负数 / 非整数）", async () => {
    const deps = makeDeps();

    for (const size of [0, -1, 1.5]) {
      const result = await handlePresignTemplateUpload(
        { type: "image", mime: "image/jpeg", size },
        deps,
      );
      expect(result.ok).toBe(false);
    }
    expect(deps.storage.prepareUpload).not.toHaveBeenCalled();
  });

  it("存储未配置 → 对象存储未配置", async () => {
    const result = await handlePresignTemplateUpload(VALID_IMAGE, {
      storage: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("对象存储未配置");
  });
});

describe("handleCompleteTemplateUpload", () => {
  function depsForComplete() {
    const deps = makeDeps();
    deps.storage.inspectObject.mockResolvedValue({
      size: VALID_IMAGE.size,
      mime: VALID_IMAGE.mime,
      publicUrl: "https://bucket.tos.test/admin/templates/image/abc123.jpg",
    });
    return deps;
  }

  it("成功 → 置 public-read + 记审计 + 返回公网 URL，不建 Asset 行", async () => {
    const deps = depsForComplete();

    const result = await handleCompleteTemplateUpload(
      { ...VALID_IMAGE, storage_key: "admin/templates/image/abc123.jpg" },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.url).toBe(
      "https://bucket.tos.test/admin/templates/image/abc123.jpg",
    );
    expect(deps.storage.makePublic).toHaveBeenCalledWith(
      "admin/templates/image/abc123.jpg",
    );
    expect(logTemplateUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "image",
        mime: "image/jpeg",
        size: VALID_IMAGE.size,
        storageKey: "admin/templates/image/abc123.jpg",
      }),
    );
  });

  it("storage_key 前缀不匹配（非 admin/templates/）→ 拒绝且不 HEAD", async () => {
    const deps = depsForComplete();

    const result = await handleCompleteTemplateUpload(
      { ...VALID_IMAGE, storage_key: "uploads/9/image/abc123.jpg" },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("前缀");
    expect(deps.storage.inspectObject).not.toHaveBeenCalled();
  });

  it("对象不存在 → 拒绝且不置 public-read", async () => {
    const deps = makeDeps();
    deps.storage.inspectObject.mockResolvedValue(null);

    const result = await handleCompleteTemplateUpload(
      { ...VALID_IMAGE, storage_key: "admin/templates/image/abc123.jpg" },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("不存在");
    expect(deps.storage.makePublic).not.toHaveBeenCalled();
  });

  it("HEAD 大小与声明不符 → 拒绝且不置 public-read", async () => {
    const deps = makeDeps();
    deps.storage.inspectObject.mockResolvedValue({
      size: VALID_IMAGE.size + 1,
      mime: VALID_IMAGE.mime,
      publicUrl: "https://bucket.tos.test/admin/templates/image/abc123.jpg",
    });

    const result = await handleCompleteTemplateUpload(
      { ...VALID_IMAGE, storage_key: "admin/templates/image/abc123.jpg" },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("大小");
    expect(deps.storage.makePublic).not.toHaveBeenCalled();
  });

  it("HEAD 类型与声明不符 → 拒绝", async () => {
    const deps = makeDeps();
    deps.storage.inspectObject.mockResolvedValue({
      size: VALID_IMAGE.size,
      mime: "image/png",
      publicUrl: "https://bucket.tos.test/admin/templates/image/abc123.jpg",
    });

    const result = await handleCompleteTemplateUpload(
      { ...VALID_IMAGE, storage_key: "admin/templates/image/abc123.jpg" },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("类型");
  });
});
