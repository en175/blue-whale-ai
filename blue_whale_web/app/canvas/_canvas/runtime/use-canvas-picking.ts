// IK74V6：Dock 从画布选取素材与帧（从 CanvasProjectRuntime 下沉）。
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { wireInteger, type WireInteger } from "@/lib/wire-integer";
import type { DockMediaItem } from "../types";
import type { Asset, CanvasNode } from "../model";
import { canvasNodeToDockMedia } from "../v2/mappers";

export type PickingTarget = "image" | "video" | "audio" | "firstFrame" | "lastFrame" | "audioRef" | "audioImageRef" | null;

export interface CanvasPickingCtx {
  assets: Record<string, Asset>;
  pickingFor: PickingTarget;
  setPickingFor: Dispatch<SetStateAction<PickingTarget>>;
  setImageDockMedia: Dispatch<SetStateAction<DockMediaItem[]>>;
  setVideoDockMedia: Dispatch<SetStateAction<DockMediaItem[]>>;
  setAudioDockMedia: Dispatch<SetStateAction<DockMediaItem[]>>;
  setFirstFrameUrl: Dispatch<SetStateAction<string | undefined>>;
  setLastFrameUrl: Dispatch<SetStateAction<string | undefined>>;
  setFirstFrameAssetId: Dispatch<SetStateAction<WireInteger | undefined>>;
  setLastFrameAssetId: Dispatch<SetStateAction<WireInteger | undefined>>;
}

export function useCanvasPicking(ctx: CanvasPickingCtx) {
  const { assets, pickingFor, setPickingFor, setImageDockMedia, setVideoDockMedia, setAudioDockMedia, setFirstFrameUrl, setLastFrameUrl, setFirstFrameAssetId, setLastFrameAssetId } = ctx;
  const handleRequestPick = useCallback(
    (mode: "image" | "video" | "audio") => {
      setPickingFor(mode);
    },
    [setPickingFor],
  );
  const handlePickFrameFromCanvas = useCallback(
    (slot: "first" | "last") => {
      setPickingFor(slot === "first" ? "firstFrame" : "lastFrame");
    },
    [setPickingFor],
  );
  const handleExitPick = useCallback(() => setPickingFor(null), [setPickingFor]);
  const handlePickNode = useCallback(
    (node: CanvasNode) => {
      const src = node.data.assetId ? assets[node.data.assetId]?.src : undefined;
      if (!src) {
        setPickingFor(null);
        return;
      }
      const item = canvasNodeToDockMedia(node, src);
      if (!item) {
        setPickingFor(null);
        return;
      }
      if (pickingFor === "image") {
        setImageDockMedia((previous) => (previous.some((media) => media.id === item.id) ? previous : [...previous, item]));
      } else if (pickingFor === "video") {
        setVideoDockMedia((previous) => (previous.some((media) => media.id === item.id) ? previous : [...previous, item]));
      } else if (pickingFor === "audio" || pickingFor === "audioRef" || pickingFor === "audioImageRef") {
        setAudioDockMedia((previous) => (previous.some((media) => media.id === item.id) ? previous : [...previous, item]));
      } else if (pickingFor === "firstFrame") {
        setFirstFrameUrl(src);
        setFirstFrameAssetId(node.data.assetId ? wireInteger(node.data.assetId) : undefined);
      } else if (pickingFor === "lastFrame") {
        setLastFrameUrl(src);
        setLastFrameAssetId(node.data.assetId ? wireInteger(node.data.assetId) : undefined);
      }
      setPickingFor(null);
    },
    [assets, pickingFor, setAudioDockMedia, setFirstFrameAssetId, setFirstFrameUrl, setImageDockMedia, setLastFrameAssetId, setLastFrameUrl, setPickingFor, setVideoDockMedia],
  );
  const handleCanvasNodeClick = useCallback(
    (node: CanvasNode) => {
      if (pickingFor && node.data.assetId) handlePickNode(node);
    },
    [handlePickNode, pickingFor],
  );

  return { handleRequestPick, handlePickFrameFromCanvas, handleExitPick, handlePickNode, handleCanvasNodeClick };
}
