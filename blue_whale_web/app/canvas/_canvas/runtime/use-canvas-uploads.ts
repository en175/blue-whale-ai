// IK74V6：画布上传与首尾帧 handlers（从 CanvasProjectRuntime 下沉）。
import { useCallback, useRef } from "react";
import {
  uploadAsset,
  ensureUploadSession,
  completeUploadSession,
  type UploadSession,
} from "@/lib/assets";
import { uploadMediaToCanvas } from "../uploadMedia";
import {
  detectMediaKind,
  fallbackMediaSize,
  readMediaNaturalSize,
  type MediaKind,
} from "@/lib/mediaSize";
import { selectUploadFiles, validateUploadFile } from "@/lib/uploadRules";
import { wireInteger, type WireInteger } from "@/lib/wire-integer";
import type { DockMediaItem } from "../types";
import type { Asset, CanvasNodeData, NodeKindId } from "../model";
import { userFriendlyErrorMessage } from "./runtime-lib";

export interface CanvasUploadsCtx {
  pid: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  uploadFilesRef: React.MutableRefObject<Map<string, { file: File; previewUrl: string }>>;
  addNode: (
    kind: NodeKindId,
    extra: { width: number; height: number; data: Partial<CanvasNodeData> },
  ) => string;
  patchNode: (
    id: string,
    patch: Partial<CanvasNodeData>,
    options?: { persist?: boolean },
  ) => void;
  resizeNode: (id: string, width: number, height: number) => void;
  addAsset: (asset: Asset) => void;
  setGenerateError: (msg: string | null) => void;
  setImageDockMedia: React.Dispatch<React.SetStateAction<DockMediaItem[]>>;
  setAudioDockMedia: React.Dispatch<React.SetStateAction<DockMediaItem[]>>;
  setVideoDockMedia: React.Dispatch<React.SetStateAction<DockMediaItem[]>>;
  setFirstFrameUrl: React.Dispatch<React.SetStateAction<string | undefined>>;
  setLastFrameUrl: React.Dispatch<React.SetStateAction<string | undefined>>;
  setFirstFrameAssetId: React.Dispatch<React.SetStateAction<WireInteger | undefined>>;
  setLastFrameAssetId: React.Dispatch<React.SetStateAction<WireInteger | undefined>>;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  firstFrameAssetId?: WireInteger;
  lastFrameAssetId?: WireInteger;
  notifyError: (message: string) => void;
}

export function useCanvasUploads(ctx: CanvasUploadsCtx) {
  const {
    pid, fileInputRef, uploadFilesRef, addNode, patchNode, resizeNode,
    addAsset, setGenerateError, setImageDockMedia, setAudioDockMedia,
    setVideoDockMedia, setFirstFrameUrl, setLastFrameUrl,
    setFirstFrameAssetId, setLastFrameAssetId,
    firstFrameUrl, lastFrameUrl, firstFrameAssetId, lastFrameAssetId, notifyError,
  } = ctx;
  const openFilePicker = useCallback((accept: string) => {
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = accept;
    input.click();
  }, [fileInputRef]);

  const uploadCanvasMedia = useCallback(
    (file: File) => {
      const previewUrl = URL.createObjectURL(file);
      const pending = uploadMediaToCanvas({
        file,
        projectId: wireInteger(pid),
        previewUrl,
        addNode,
        patchNode,
        resizeNode,
        addAsset,
        onError: setGenerateError,
      });
      // 成功：revoke 预览 URL 并弃 File；失败：留存 File+URL 供错误卡重试/移除
      void pending.then((result) => {
        if (result.asset) {
          URL.revokeObjectURL(previewUrl);
          uploadFilesRef.current.delete(result.nodeId);
        } else {
          uploadFilesRef.current.set(result.nodeId, { file, previewUrl });
        }
      });
      return pending;
    },
    [addAsset, addNode, patchNode, pid, resizeNode, setGenerateError],
  );

  /**
   * 对话面板上传（IK67GX T03）：持久化 Asset → 创建 NodeItem 并首次放置 → 面板插入 pill。
   * 会话按 File 弱引用缓存：PUT/complete 失败后重试沿用同一 storage_key，
   * complete 幂等 ⇒ 每个文件至多一个 Asset，重试不重复创建。
   */
  const composerUploadSessionsRef = useRef(new WeakMap<File, UploadSession>());
  const handleComposerUploadFile = useCallback(
    async (
      file: File,
    ): Promise<{ assetId: string; url: string; kind: MediaKind }> => {
      const kind = detectMediaKind(file);
      const session = await ensureUploadSession(
        file,
        kind,
        composerUploadSessionsRef.current.get(file) ?? null,
      );
      // PUT 前先存会话：这一步之后任何失败，重试都能沿用同一 storage_key
      composerUploadSessionsRef.current.set(file, session);
      const { assetId, url } = await completeUploadSession({
        file,
        projectId: wireInteger(pid),
        kind,
        session,
      });
      addAsset({ id: assetId, kind, src: url, source: "uploaded" });
      let size = fallbackMediaSize(kind);
      try {
        size = await readMediaNaturalSize(url, kind);
      } catch {
        // 尺寸探测失败不阻断：Asset 已持久化，节点用默认尺寸落位
      }
      addNode(kind, {
        width: size.width,
        height: size.height,
        data: {
          content: file.name,
          status: "done",
          assetId,
          recipe: { origin: "uploaded" },
        },
      });
      // 节点落地成功后才丢弃会话：此前任何失败，重试沿用同一 storage_key
      // （complete 幂等），不会重复创建 Asset
      composerUploadSessionsRef.current.delete(file);
      return { assetId, url, kind };
    },
    [pid, addNode, addAsset],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (!files.length || !pid) return;
      // 白名单+大小校验：合法逐个上传落画布，非法 toast 拒绝（不发请求）
      selectUploadFiles(files, {
        upload: (file) => {
          void uploadCanvasMedia(file);
        },
        reject: notifyError,
      });
    },
    [notifyError, pid, uploadCanvasMedia],
  );

  const handleDockLocalUpload = useCallback(
    async (file: File, mode: "image" | "video" | "audio") => {
      if (!pid) return;
      // IK6M68：Dock 上传补白名单 + 大小校验（对齐工具栏上传；音频参考无规则，跳过）
      if (mode !== "audio") {
        const validation = validateUploadFile(file);
        if (!validation.ok) {
          notifyError(validation.reason);
          return;
        }
      }
      const result = await uploadCanvasMedia(file);
      if (!result.asset) return;
      const item: DockMediaItem = {
        id: result.nodeId,
        type: result.asset.kind,
        name: file.name,
        src: result.asset.url,
        assetId: result.asset.id,
      };
      if (mode === "image")
        setImageDockMedia((prev) =>
          prev.some((m) => m.id === result.nodeId) ? prev : [...prev, item],
        );
      else if (mode === "audio")
        setAudioDockMedia((prev) =>
          prev.some((m) => m.id === result.nodeId) ? prev : [...prev, item],
        );
      else
        setVideoDockMedia((prev) =>
          prev.some((m) => m.id === result.nodeId) ? prev : [...prev, item],
        );
    },
    [notifyError, pid, uploadCanvasMedia],
  );

  const handleFrameUpload = useCallback(
    async (file: File, slot: "first" | "last") => {
      if (!pid) return;
      try {
        const result = await uploadAsset(file, wireInteger(pid), "image");
        const assetId = wireInteger(result.id);
        if (slot === "first") {
          setFirstFrameUrl(result.url);
          setFirstFrameAssetId(assetId);
        } else {
          setLastFrameUrl(result.url);
          setLastFrameAssetId(assetId);
        }
      } catch (e) {
        setGenerateError(userFriendlyErrorMessage(e));
      }
    },
    [pid, setGenerateError],
  );

  const handleFrameClear = useCallback((slot: "first" | "last") => {
    if (slot === "first") {
      setFirstFrameUrl(undefined);
      setFirstFrameAssetId(undefined);
    } else {
      setLastFrameUrl(undefined);
      setLastFrameAssetId(undefined);
    }
  }, [setFirstFrameAssetId, setFirstFrameUrl, setLastFrameAssetId, setLastFrameUrl]);

  const handleSwapFrames = useCallback(() => {
    setFirstFrameUrl(lastFrameUrl);
    setLastFrameUrl(firstFrameUrl);
    setFirstFrameAssetId(lastFrameAssetId);
    setLastFrameAssetId(firstFrameAssetId);
  }, [firstFrameUrl, lastFrameUrl, firstFrameAssetId, lastFrameAssetId, setFirstFrameAssetId, setFirstFrameUrl, setLastFrameAssetId, setLastFrameUrl]);
  return {
    openFilePicker,
    uploadCanvasMedia,
    handleComposerUploadFile,
    handleFileChange,
    handleDockLocalUpload,
    handleFrameUpload,
    handleFrameClear,
    handleSwapFrames,
  };
}
