// IK74V6：节点新增与节点工具栏动作（从 CanvasProjectRuntime 下沉）。
import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { wireInteger, type WireInteger } from "@/lib/wire-integer";
import type {
  DockMediaItem,
  PendingMentionBatch,
  PrefillSignal,
} from "../types";
import type { Asset as CanvasAsset, CanvasNode } from "../model";
import {
  buildCrossmodalRefill,
  nodeToPendingMention,
  recipeToDockPrefill,
} from "../v2/mappers";

export interface NodeActionsCtx {
  assets: Record<string, CanvasAsset>;
  referenceGenTargetRef: MutableRefObject<string | null>;
  generateFromNode: (nodeId: string) => void;
  setBottomDockMode: Dispatch<SetStateAction<"image" | "video" | "audio">>;
  setImageDockMedia: Dispatch<SetStateAction<DockMediaItem[]>>;
  setVideoDockMedia: Dispatch<SetStateAction<DockMediaItem[]>>;
  setAudioDockMedia: Dispatch<SetStateAction<DockMediaItem[]>>;
  setFirstFrameUrl: Dispatch<SetStateAction<string | undefined>>;
  setLastFrameUrl: Dispatch<SetStateAction<string | undefined>>;
  setFirstFrameAssetId: Dispatch<SetStateAction<WireInteger | undefined>>;
  setLastFrameAssetId: Dispatch<SetStateAction<WireInteger | undefined>>;
  setAgentPendingMention: Dispatch<SetStateAction<PendingMentionBatch | null>>;
  setDockMentionSignal: Dispatch<
    SetStateAction<{
      nonce: number;
      item: import("../components/dock/mention").MentionItem | null;
      replace?: boolean;
    }>
  >;
  setPrefillSignal: Dispatch<SetStateAction<PrefillSignal | null>>;
  setIsAgentOpen: Dispatch<SetStateAction<boolean>>;
  setIsBottomDockOpen: Dispatch<SetStateAction<boolean>>;
  setDockFocusSignal: Dispatch<SetStateAction<number>>;
  setInfoNodeId: Dispatch<SetStateAction<string | null>>;
  setGenerateError: (message: string | null) => void;
}

export function useNodeActions(ctx: NodeActionsCtx) {
  const {
    assets,
    referenceGenTargetRef,
    generateFromNode,
    setBottomDockMode,
    setImageDockMedia,
    setVideoDockMedia,
    setAudioDockMedia,
    setFirstFrameUrl,
    setLastFrameUrl,
    setFirstFrameAssetId,
    setLastFrameAssetId,
    setAgentPendingMention,
    setDockMentionSignal,
    setPrefillSignal,
    setIsAgentOpen,
    setIsBottomDockOpen,
    setDockFocusSignal,
    setInfoNodeId,
    setGenerateError,
  } = ctx;

  const handleNodeAction = useCallback(
    (node: CanvasNode, actionId: string) => {
      const name = (node.data.content as string) || "未命名素材";
      const src = node.data.assetId
        ? assets[node.data.assetId]?.src
        : undefined;
      referenceGenTargetRef.current = null;
      switch (actionId) {
        case "refresh": {
          const gen = node.data.recipe?.generation;
          if (gen) {
            const prefill = recipeToDockPrefill(gen);
            setBottomDockMode(gen.mediaKind === "video" ? "video" : "image");
            setFirstFrameUrl(prefill.firstFrameUrl);
            setLastFrameUrl(prefill.lastFrameUrl);
            const firstFrameId = Number(prefill.firstFrameAssetId);
            const lastFrameId = Number(prefill.lastFrameAssetId);
            setFirstFrameAssetId(
              Number.isSafeInteger(firstFrameId) && firstFrameId > 0
                ? firstFrameId
                : undefined,
            );
            setLastFrameAssetId(
              Number.isSafeInteger(lastFrameId) && lastFrameId > 0
                ? lastFrameId
                : undefined,
            );
            const items: DockMediaItem[] = (prefill.references ?? []).map(
              (reference, index) => ({
                id: `prefill-${Date.now()}-${index}`,
                type: reference.kind,
                name: "",
                src: reference.url,
                assetId: reference.assetId,
              }),
            );
            if (gen.mediaKind === "video") setVideoDockMedia(items);
            else setImageDockMedia(items);
            setPrefillSignal({ nonce: Date.now(), prefill });
          } else {
            setBottomDockMode(node.data.kind === "video" ? "video" : "image");
          }
          setIsBottomDockOpen(true);
          setDockFocusSignal((value) => value + 1);
          break;
        }
        case "shuffle":
        case "image": {
          setBottomDockMode("image");
          setIsBottomDockOpen(true);
          setDockFocusSignal((value) => value + 1);
          if (src) {
            const item: DockMediaItem = {
              id: node.id,
              type: "image",
              name,
              src,
              assetId: node.data.assetId,
            };
            setImageDockMedia([item]);
            setDockMentionSignal({
              nonce: Date.now(),
              item: {
                src,
                name,
                id: node.id,
                type: "image",
                assetId: node.data.assetId
                  ? wireInteger(node.data.assetId)
                  : undefined,
              },
              replace: true,
            });
          }
          break;
        }
        case "mention": {
          setIsAgentOpen(true);
          const batchId = Date.now();
          setAgentPendingMention({
            mentions: [
              // 参考卡走 nodeToPendingMention 的 reference 分支（assetId 取
              // referenceAssetId、卡名/类型名作 name），与右键「添加到聊天」同一映射。
              node.data.kind === "reference"
                ? nodeToPendingMention(node, assets, batchId)
                : {
                    name,
                    nonce: batchId,
                    ...(src ? { src } : {}),
                    ...(node.data.assetId
                      ? { assetId: wireInteger(node.data.assetId) }
                      : {}),
                    ...(node.data.kind === "image" ||
                    node.data.kind === "video" ||
                    node.data.kind === "audio"
                      ? { type: node.data.kind }
                      : {}),
                  },
            ],
            batchId,
          });
          break;
        }
        case "video":
        case "audio":
        case "extract-audio": {
          const refill = buildCrossmodalRefill(node, actionId, src);
          if (!refill) break;
          if (refill.derived) {
            setGenerateError("提取音频：后端未接入（占位）");
            break;
          }
          if (refill.mode && refill.media) {
            setBottomDockMode(refill.mode);
            setIsBottomDockOpen(true);
            const media = { ...refill.media, assetId: node.data.assetId };
            if (refill.mode === "video") setVideoDockMedia([media]);
            else if (refill.mode === "audio") setAudioDockMedia([media]);
          }
          break;
        }
        case "download": {
          if (src) {
            const anchor = document.createElement("a");
            anchor.href = src;
            anchor.download = name || "image";
            anchor.target = "_blank";
            anchor.rel = "noopener noreferrer";
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
          }
          break;
        }
        case "generate":
          generateFromNode(node.id);
          break;
        case "info":
          setInfoNodeId(node.id);
          break;
        default:
          break;
      }
    },
    [
      assets,
      generateFromNode,
      referenceGenTargetRef,
      setAgentPendingMention,
      setAudioDockMedia,
      setBottomDockMode,
      setDockFocusSignal,
      setDockMentionSignal,
      setFirstFrameAssetId,
      setFirstFrameUrl,
      setGenerateError,
      setImageDockMedia,
      setInfoNodeId,
      setIsAgentOpen,
      setIsBottomDockOpen,
      setLastFrameAssetId,
      setLastFrameUrl,
      setPrefillSignal,
      setVideoDockMedia,
    ],
  );

  return { handleNodeAction };
}
