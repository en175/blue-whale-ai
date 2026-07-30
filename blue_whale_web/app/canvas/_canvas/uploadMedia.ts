import { uploadAsset } from "@/lib/assets";
import {
  detectMediaKind,
  fallbackMediaSize,
  readMediaNaturalSize,
  type MediaKind,
  type PixelSize,
} from "@/lib/mediaSize";

import type { Asset, CanvasNodeData, NodeKindId } from "./model";
import type { WireInteger } from "@/lib/wire-integer";

export type UploadMediaResult = {
  nodeId: string;
  asset: { id: string; url: string; kind: MediaKind } | null;
};

type UploadMediaInput = {
  file: File;
  projectId: WireInteger;
  /** 重试既有失败占位节点：跳过 addNode，原地 patch 回 running 重走管线。 */
  existingNodeId?: string;
  /** 本地预览 object URL（占位卡缩略图）；仅进节点 data，serialize 白名单不映射、不持久化。 */
  previewUrl?: string;
  addNode: (
    kind: NodeKindId,
    extra: {
      width: number;
      height: number;
      data: Partial<CanvasNodeData>;
    },
  ) => string;
  patchNode: (id: string, patch: Partial<CanvasNodeData>) => void;
  resizeNode: (id: string, width: number, height: number) => void;
  addAsset: (asset: Asset) => void;
  onError: (message: string) => void;
  upload?: typeof uploadAsset;
  readSize?: (url: string, kind: MediaKind) => Promise<PixelSize>;
};

function uploadErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "上传失败，请稍后重试";
  if (
    error.message.includes("后端未启动") ||
    error.message.includes("无法连接")
  ) {
    return "无法连接到服务，请检查网络或稍后重试";
  }
  return "上传失败，请稍后重试";
}

/**
 * Canvas 本地媒体上传状态机：同步创建占位节点，完成后原位补全，失败后原位报错。
 * existingNodeId（重试）：不新建节点，原地 patch 回 running 重走管线。
 * 上传中经 upload 的 onProgress 把百分比 patch 到占位卡；完成/失败时清掉 progress。
 */
export async function uploadMediaToCanvas(
  input: UploadMediaInput,
): Promise<UploadMediaResult> {
  const kind = detectMediaKind(input.file);
  let nodeId: string;
  if (input.existingNodeId) {
    nodeId = input.existingNodeId;
    input.patchNode(nodeId, {
      status: "running",
      progress: 0,
      errorMessage: undefined,
      ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}),
    });
  } else {
    const initialSize = fallbackMediaSize(kind);
    nodeId = input.addNode(kind, {
      width: initialSize.width,
      height: initialSize.height,
      data: {
        content: input.file.name,
        status: "running",
        recipe: { origin: "uploaded" },
        ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}),
      },
    });
  }

  try {
    const upload = input.upload ?? uploadAsset;
    const readSize = input.readSize ?? readMediaNaturalSize;
    const result = await upload(input.file, input.projectId, kind, (pct) =>
      input.patchNode(nodeId, { progress: pct }),
    );
    const size = await readSize(result.url, kind);
    input.addAsset({
      id: result.id,
      kind,
      src: result.url,
      source: "uploaded",
    });
    input.resizeNode(nodeId, size.width, size.height);
    input.patchNode(nodeId, {
      status: "done",
      assetId: result.id,
      progress: undefined,
    });
    return {
      nodeId,
      asset: { id: result.id, url: result.url, kind },
    };
  } catch (error) {
    const message = uploadErrorMessage(error);
    input.patchNode(nodeId, {
      status: "error",
      errorMessage: message,
      progress: undefined,
    });
    input.onError(message);
    return { nodeId, asset: null };
  }
}
