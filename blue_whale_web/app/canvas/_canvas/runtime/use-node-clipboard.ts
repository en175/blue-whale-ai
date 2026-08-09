// IK74V6：节点剪贴板、右键菜单与快捷键（从 CanvasProjectRuntime 下沉）。
import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { NodeMenuAction, PendingMentionBatch } from "../types";
import { cloneNodeWithOffset, parseClipboardNodes, serializeNodesForClipboard } from "../v2/clipboard";
import { nodeToPendingMention } from "../v2/mappers";
import type { Asset, CanvasNode } from "../model";
import { isNodeSelected } from "./runtime-lib";
import { savedAssetsToastText, saveToSharedAssets } from "../cardLibrary";

export type CanvasNodeMenu = {
  screenX: number;
  screenY: number;
  targetIds: string[];
};

type UploadFileEntry = { file: File; previewUrl: string };

export interface NodeClipboardCtx {
  nodes: CanvasNode[];
  assets: Record<string, Asset>;
  nodeMenu: CanvasNodeMenu | null;
  setNodeMenu: Dispatch<SetStateAction<CanvasNodeMenu | null>>;
  addNodeFull: (node: CanvasNode) => void;
  onNodesChange: (changes: Array<{ type: "remove"; id: string }>) => void;
  uploadFilesRef: MutableRefObject<Map<string, UploadFileEntry>>;
  setIsAgentOpen: Dispatch<SetStateAction<boolean>>;
  setAgentPendingMention: Dispatch<SetStateAction<PendingMentionBatch | null>>;
  notifySuccess: (message: string) => void;
}

export function useNodeClipboard(ctx: NodeClipboardCtx) {
  const { nodes, assets, nodeMenu, setNodeMenu, addNodeFull, onNodesChange, uploadFilesRef, setIsAgentOpen, setAgentPendingMention, notifySuccess } = ctx;
  const copyNodesToClipboard = useCallback((targets: CanvasNode[]) => {
    void navigator.clipboard.writeText(serializeNodesForClipboard(targets));
  }, []);
  const duplicateNodes = useCallback(
    (targets: CanvasNode[]) => {
      for (const source of targets) addNodeFull(cloneNodeWithOffset(source));
    },
    [addNodeFull],
  );
  const pasteNodesFromClipboard = useCallback(async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }
    for (const node of parseClipboardNodes(text)) addNodeFull(node);
  }, [addNodeFull]);
  const handleNodeMenuAction = useCallback(
    (action: NodeMenuAction) => {
      if (!nodeMenu) return;
      const { targetIds } = nodeMenu;
      setNodeMenu(null);
      const targets = nodes.filter((node) => targetIds.includes(node.id));
      switch (action) {
        case "delete":
          for (const id of targetIds) {
            const entry = uploadFilesRef.current.get(id);
            if (entry) {
              URL.revokeObjectURL(entry.previewUrl);
              uploadFilesRef.current.delete(id);
            }
          }
          onNodesChange(targetIds.map((id) => ({ type: "remove", id })));
          break;
        case "copy":
          copyNodesToClipboard(targets);
          break;
        case "duplicate":
          duplicateNodes(targets);
          break;
        case "save-to-assets": {
          const message = savedAssetsToastText(saveToSharedAssets(targets));
          if (message) notifySuccess(message);
          break;
        }
        case "add-to-chat": {
          const mentionTargets = targets.filter((node) => node.data.kind !== "group");
          if (mentionTargets.length === 0) break;
          const batchId = Date.now();
          setIsAgentOpen(true);
          setAgentPendingMention({
            mentions: mentionTargets.map((node, index) => nodeToPendingMention(node, assets, batchId + index)),
            batchId,
          });
          break;
        }
        default:
          break;
      }
    },
    [assets, copyNodesToClipboard, duplicateNodes, nodeMenu, nodes, notifySuccess, onNodesChange, setAgentPendingMention, setIsAgentOpen, setNodeMenu, uploadFilesRef],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "c" && key !== "d" && key !== "v") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;
      if (key === "v") {
        event.preventDefault();
        void pasteNodesFromClipboard();
        return;
      }
      if (window.getSelection()?.toString()) return;
      const selected = nodes.filter(isNodeSelected);
      if (selected.length === 0) return;
      event.preventDefault();
      if (key === "c") copyNodesToClipboard(selected);
      else duplicateNodes(selected);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copyNodesToClipboard, duplicateNodes, nodes, pasteNodesFromClipboard]);

  return { handleNodeMenuAction };
}
