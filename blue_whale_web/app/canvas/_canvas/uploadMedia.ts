import { uploadAsset } from "@/lib/assets";
import {
  detectMediaKind,
  fallbackMediaSize,
  readMediaNaturalSize,
  type MediaKind,
  type PixelSize,
} from "@/lib/mediaSize";

import type { Asset, CanvasNodeData, NodeKindId } from "./model";

export type UploadMediaResult = {
  nodeId: string;
  asset: { id: string; url: string; kind: MediaKind } | null;
};

type UploadMediaInput = {
  file: File;
  projectId: number;
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
 */
export async function uploadMediaToCanvas(
  input: UploadMediaInput,
): Promise<UploadMediaResult> {
  const kind = detectMediaKind(input.file);
  const initialSize = fallbackMediaSize(kind);
  const nodeId = input.addNode(kind, {
    width: initialSize.width,
    height: initialSize.height,
    data: {
      content: input.file.name,
      status: "running",
      recipe: { origin: "uploaded" },
    },
  });

  try {
    const upload = input.upload ?? uploadAsset;
    const readSize = input.readSize ?? readMediaNaturalSize;
    const result = await upload(input.file, input.projectId, kind);
    const size = await readSize(result.url, kind);
    input.addAsset({
      id: result.id,
      kind,
      src: result.url,
      source: "uploaded",
    });
    input.resizeNode(nodeId, size.width, size.height);
    input.patchNode(nodeId, { status: "done", assetId: result.id });
    return {
      nodeId,
      asset: { id: result.id, url: result.url, kind },
    };
  } catch (error) {
    const message = uploadErrorMessage(error);
    input.patchNode(nodeId, { status: "error", errorMessage: message });
    input.onError(message);
    return { nodeId, asset: null };
  }
}
