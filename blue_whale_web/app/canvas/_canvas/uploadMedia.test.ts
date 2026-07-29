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
      expect(upload).toHaveBeenCalledWith(file, 12, kind);
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
