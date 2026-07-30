import { describe, expect, it, vi } from "vitest";

import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  UPLOAD_ACCEPT,
  selectUploadFiles,
  validateUploadFile,
} from "./uploadRules";

const fileOf = (name: string, size = 1, type = "") => ({ name, size, type });

describe("UPLOAD_ACCEPT", () => {
  it("仅含图片/视频白名单扩展名（无音频）", () => {
    expect(UPLOAD_ACCEPT).toBe(".jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.webm");
  });
});

describe("validateUploadFile / 格式白名单", () => {
  it.each(["a.jpg", "a.jpeg", "a.png", "a.webp", "a.gif"])(
    "放行图片 %s",
    (name) => {
      expect(validateUploadFile(fileOf(name))).toEqual({
        ok: true,
        kind: "image",
      });
    },
  );

  it.each(["a.mp4", "a.mov", "a.webm"])("放行视频 %s", (name) => {
    expect(validateUploadFile(fileOf(name))).toEqual({
      ok: true,
      kind: "video",
    });
  });

  it.each([
    "A.JPG",
    "A.JPEG",
    "A.PNG",
    "A.WEBP",
    "A.GIF",
    "A.MP4",
    "A.MOV",
    "A.WEBM",
  ])("放行大写扩展名 %s", (name) => {
    expect(validateUploadFile(fileOf(name)).ok).toBe(true);
  });

  it.each(["a.mp3", "a.aac", "a.wav", "a.txt", "a.svg", "noext"])(
    "拒绝 %s",
    (name) => {
      expect(validateUploadFile(fileOf(name))).toEqual({
        ok: false,
        reason: "仅支持图片与视频格式",
      });
    },
  );

  it("音频 MIME 也按扩展名拒绝（accept 可绕过，不能依赖 MIME）", () => {
    expect(validateUploadFile(fileOf("a.mp3", 1, "audio/mpeg"))).toEqual({
      ok: false,
      reason: "仅支持图片与视频格式",
    });
  });

  it("扩展名不在白名单时即使 MIME 合法也拒绝", () => {
    expect(validateUploadFile(fileOf("a.tiff", 1, "image/tiff"))).toEqual({
      ok: false,
      reason: "仅支持图片与视频格式",
    });
  });

  it("扩展名缺失时回退 MIME 前缀判断 kind", () => {
    expect(validateUploadFile(fileOf("noext", 1, "image/png"))).toEqual({
      ok: true,
      kind: "image",
    });
    expect(validateUploadFile(fileOf("noext", 1, "video/mp4"))).toEqual({
      ok: true,
      kind: "video",
    });
  });
});

describe("validateUploadFile / 大小上限", () => {
  it("图片恰好 20MB 放行", () => {
    expect(validateUploadFile(fileOf("a.png", MAX_IMAGE_BYTES))).toEqual({
      ok: true,
      kind: "image",
    });
  });

  it("图片超 20MB 1 字节拒绝", () => {
    expect(validateUploadFile(fileOf("a.png", MAX_IMAGE_BYTES + 1))).toEqual({
      ok: false,
      reason: "图片超过 20MB，无法上传",
    });
  });

  it("视频恰好 500MB 放行", () => {
    expect(validateUploadFile(fileOf("a.mp4", MAX_VIDEO_BYTES))).toEqual({
      ok: true,
      kind: "video",
    });
  });

  it("视频超 500MB 1 字节拒绝", () => {
    expect(validateUploadFile(fileOf("a.mp4", MAX_VIDEO_BYTES + 1))).toEqual({
      ok: false,
      reason: "视频超过 500MB，无法上传",
    });
  });
});

describe("selectUploadFiles / 多选分发", () => {
  it("非法文件只 reject，upload 一次都没被调（不发任何上传请求）", () => {
    const upload = vi.fn();
    const reject = vi.fn();

    selectUploadFiles([fileOf("a.mp3"), fileOf("b.txt")], { upload, reject });

    expect(upload).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledTimes(2);
    expect(reject).toHaveBeenCalledWith("仅支持图片与视频格式");
  });

  it("超大文件 reject 且不发上传请求", () => {
    const upload = vi.fn();
    const reject = vi.fn();

    selectUploadFiles([fileOf("big.png", MAX_IMAGE_BYTES + 1)], {
      upload,
      reject,
    });

    expect(upload).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledWith("图片超过 20MB，无法上传");
  });

  it("混合输入只上传合法文件，非法文件逐个 reject", () => {
    const upload = vi.fn();
    const reject = vi.fn();
    const okImage = fileOf("a.png");
    const okVideo = fileOf("b.mp4");

    selectUploadFiles([okImage, fileOf("x.mp3"), okVideo], { upload, reject });

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenNthCalledWith(1, okImage);
    expect(upload).toHaveBeenNthCalledWith(2, okVideo);
    expect(reject).toHaveBeenCalledTimes(1);
  });

  it("多选全部合法时全部上传，顺序保持", () => {
    const upload = vi.fn();
    const reject = vi.fn();
    const files = [fileOf("a.png"), fileOf("b.mp4"), fileOf("c.webp")];

    selectUploadFiles(files, { upload, reject });

    expect(upload).toHaveBeenCalledTimes(3);
    expect(upload.mock.calls.map(([f]) => f)).toEqual(files);
    expect(reject).not.toHaveBeenCalled();
  });
});
