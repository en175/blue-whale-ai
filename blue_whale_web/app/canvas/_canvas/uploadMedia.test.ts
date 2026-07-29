import { describe, expect, it, vi } from "vitest";

import { uploadMediaToCanvas } from "./uploadMedia";

describe("uploadMediaToCanvas", () => {
  it.each([
    ["image/png", "cat.png", "image", 200, 200],
    ["video/mp4", "clip.mp4", "video", 356, 200],
    ["audio/mpeg", "voice.mp3", "audio", 240, 120],
  ] as const)(
    "creates a %s running placeholder before upload resolves",
    async (mime, name, kind, width, height) => {
      let resolveUpload!: (value: { id: string; url: string }) => void;
      const uploadPromise = new Promise<{ id: string; url: string }>(
        (resolve) => {
          resolveUpload = resolve;
        },
      );
      const addNode = vi.fn().mockReturnValue("n_upload");
      const patchNode = vi.fn();
      const resizeNode = vi.fn();
      const addAsset = vi.fn();
      const upload = vi.fn().mockReturnValue(uploadPromise);
      const readSize = vi.fn().mockResolvedValue({ width: 480, height: 270 });
      const file = new File(["x"], name, { type: mime });

      const pending = uploadMediaToCanvas({
        file,
        projectId: 12,
        addNode,
        patchNode,
        resizeNode,
        addAsset,
        upload,
        readSize,
        onError: vi.fn(),
      });

      expect(addNode).toHaveBeenCalledWith(kind, {
        width,
        height,
        data: {
          content: name,
          status: "running",
          recipe: { origin: "uploaded" },
        },
      });
      expect(patchNode).not.toHaveBeenCalled();

      resolveUpload({ id: "77", url: `https://assets.test/${name}` });
      await expect(pending).resolves.toEqual({
        nodeId: "n_upload",
        asset: {
          id: "77",
          url: `https://assets.test/${name}`,
          kind,
        },
      });
      expect(upload).toHaveBeenCalledWith(file, 12, kind, expect.any(Function));
      expect(addAsset).toHaveBeenCalledWith({
        id: "77",
        kind,
        src: `https://assets.test/${name}`,
        source: "uploaded",
      });
      expect(resizeNode).toHaveBeenCalledWith("n_upload", 480, 270);
      expect(patchNode).toHaveBeenCalledWith("n_upload", {
        status: "done",
        assetId: "77",
      });
    },
  );

  it("upload onProgress 回调把进度 patch 到占位卡，完成后 progress 被清", async () => {
    const addNode = vi.fn().mockReturnValue("n_prog");
    const patchNode = vi.fn();
    const upload = vi.fn(
      async (
        _file: File,
        _projectId?: number,
        _kind?: string,
        onProgress?: (pct: number) => void,
      ) => {
        onProgress?.(42);
        return { id: "77", url: "https://assets.test/cat.png" };
      },
    );

    await uploadMediaToCanvas({
      file: new File(["x"], "cat.png", { type: "image/png" }),
      projectId: 12,
      addNode,
      patchNode,
      resizeNode: vi.fn(),
      addAsset: vi.fn(),
      upload,
      readSize: vi.fn().mockResolvedValue({ width: 200, height: 200 }),
      onError: vi.fn(),
    });

    expect(patchNode).toHaveBeenCalledWith("n_prog", { progress: 42 });
    const donePatch = patchNode.mock.calls.at(-1)?.[1] as Record<
      string,
      unknown
    >;
    expect(donePatch.status).toBe("done");
    expect(Object.keys(donePatch)).toContain("progress");
    expect(donePatch.progress).toBeUndefined();
  });

  it("失败后 progress 同样被清", async () => {
    const patchNode = vi.fn();

    await uploadMediaToCanvas({
      file: new File(["x"], "cat.png", { type: "image/png" }),
      projectId: 12,
      addNode: vi.fn().mockReturnValue("n_err"),
      patchNode,
      resizeNode: vi.fn(),
      addAsset: vi.fn(),
      upload: vi.fn().mockRejectedValue(new Error("boom")),
      readSize: vi.fn(),
      onError: vi.fn(),
    });

    const errorPatch = patchNode.mock.calls.at(-1)?.[1] as Record<
      string,
      unknown
    >;
    expect(errorPatch.status).toBe("error");
    expect(Object.keys(errorPatch)).toContain("progress");
    expect(errorPatch.progress).toBeUndefined();
  });

  it("传入 previewUrl 时占位节点 data 带 previewUrl", async () => {
    const addNode = vi.fn().mockReturnValue("n_prev");

    await uploadMediaToCanvas({
      file: new File(["x"], "cat.png", { type: "image/png" }),
      projectId: 12,
      previewUrl: "blob:preview-1",
      addNode,
      patchNode: vi.fn(),
      resizeNode: vi.fn(),
      addAsset: vi.fn(),
      upload: vi.fn().mockResolvedValue({ id: "77", url: "https://a/x.png" }),
      readSize: vi.fn().mockResolvedValue({ width: 200, height: 200 }),
      onError: vi.fn(),
    });

    expect(addNode).toHaveBeenCalledWith("image", {
      width: 200,
      height: 200,
      data: {
        content: "cat.png",
        status: "running",
        recipe: { origin: "uploaded" },
        previewUrl: "blob:preview-1",
      },
    });
  });

  it("重试：existingNodeId 跳过 addNode，原地 patch 回 running 并重新走管线", async () => {
    const addNode = vi.fn();
    const patchNode = vi.fn();
    const upload = vi
      .fn()
      .mockResolvedValue({ id: "88", url: "https://assets.test/v.mp4" });
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });

    const result = await uploadMediaToCanvas({
      file,
      projectId: 12,
      existingNodeId: "n_exist",
      previewUrl: "blob:preview-2",
      addNode,
      patchNode,
      resizeNode: vi.fn(),
      addAsset: vi.fn(),
      upload,
      readSize: vi.fn().mockResolvedValue({ width: 480, height: 270 }),
      onError: vi.fn(),
    });

    expect(addNode).not.toHaveBeenCalled();
    expect(result.nodeId).toBe("n_exist");
    const retryPatch = patchNode.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(patchNode.mock.calls[0]?.[0]).toBe("n_exist");
    expect(retryPatch.status).toBe("running");
    expect(retryPatch.progress).toBe(0);
    expect(Object.keys(retryPatch)).toContain("errorMessage");
    expect(retryPatch.errorMessage).toBeUndefined();
    expect(retryPatch.previewUrl).toBe("blob:preview-2");
    expect(upload).toHaveBeenCalledWith(
      file,
      12,
      "video",
      expect.any(Function),
    );
    expect(patchNode).toHaveBeenLastCalledWith(
      "n_exist",
      expect.objectContaining({ status: "done", assetId: "88" }),
    );
  });

  it("重试失败：原地 patch 回 error，不新建节点", async () => {
    const addNode = vi.fn();
    const patchNode = vi.fn();
    const onError = vi.fn();

    const result = await uploadMediaToCanvas({
      file: new File(["x"], "cat.png", { type: "image/png" }),
      projectId: 12,
      existingNodeId: "n_exist",
      addNode,
      patchNode,
      resizeNode: vi.fn(),
      addAsset: vi.fn(),
      upload: vi.fn().mockRejectedValue(new Error("boom")),
      readSize: vi.fn(),
      onError,
    });

    expect(addNode).not.toHaveBeenCalled();
    expect(result).toEqual({ nodeId: "n_exist", asset: null });
    expect(patchNode).toHaveBeenLastCalledWith(
      "n_exist",
      expect.objectContaining({
        status: "error",
        errorMessage: "上传失败，请稍后重试",
      }),
    );
  });

  it("patches the same placeholder to error when upload fails", async () => {
    const addNode = vi.fn().mockReturnValue("n_failed");
    const patchNode = vi.fn();
    const onError = vi.fn();

    await expect(
      uploadMediaToCanvas({
        file: new File(["x"], "broken.png", { type: "image/png" }),
        projectId: 12,
        addNode,
        patchNode,
        resizeNode: vi.fn(),
        addAsset: vi.fn(),
        upload: vi.fn().mockRejectedValue(new Error("upload rejected")),
        readSize: vi.fn(),
        onError,
      }),
    ).resolves.toEqual({ nodeId: "n_failed", asset: null });

    expect(patchNode).toHaveBeenCalledWith("n_failed", {
      status: "error",
      errorMessage: "上传失败，请稍后重试",
    });
    expect(onError).toHaveBeenCalledWith("上传失败，请稍后重试");
  });
});
