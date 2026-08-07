import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { NodeChange } from "@xyflow/react";

import type { Asset, CanvasEdge, CanvasNode, CanvasNodeData } from "../model";
import type { CanvasMenuPayload } from "../types";
import type { CardMessage } from "../nodeFromCard";
import type { Rect } from "../placement";
import { findPlacement } from "../placement";
import { cardToV2ImageFields } from "../v2/mappers";
import { isNodeSelected } from "./runtime-lib";
import type { AddCanvasNode } from "./use-add-node";
import type { CanvasNodeMenu } from "./use-node-clipboard";
import { uploadMediaToCanvas } from "../uploadMedia";
import { getCardLibraryAsset } from "../cardLibrary";
import { productImportHydrationAssets } from "../productImport";

type InsertKind = "text" | "image" | "video";

export interface CanvasSurfaceRuntimeCtx {
  projectId: string;
  nodes: CanvasNode[];
  assets: Record<string, Asset>;
  menu: CanvasMenuPayload | null;
  setMenu: Dispatch<SetStateAction<CanvasMenuPayload | null>>;
  setNodeMenu: Dispatch<SetStateAction<CanvasNodeMenu | null>>;
  existingRects: () => Rect[];
  addNode: AddCanvasNode;
  addNodeFull: (node: CanvasNode) => void;
  addEdgeFull: (edge: CanvasEdge) => void;
  patchNode: (id: string, patch: Partial<CanvasNodeData>) => void;
  resizeNode: (id: string, width: number, height: number) => void;
  addAsset: (asset: Asset) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  uploadFilesRef: MutableRefObject<
    Map<string, { file: File; previewUrl: string }>
  >;
  handleNodeAction: (node: CanvasNode, actionId: string) => void;
  cancelVideoJob: (taskId: number) => void;
  retryNode: (nodeId: string) => Promise<void>;
  setGenerateError: (message: string | null) => void;
}

export function useCanvasSurfaceRuntime(ctx: CanvasSurfaceRuntimeCtx) {
  const {
    projectId,
    nodes,
    assets,
    menu,
    setMenu,
    setNodeMenu,
    existingRects,
    addNode,
    addNodeFull,
    addEdgeFull,
    patchNode,
    resizeNode,
    addAsset,
    onNodesChange,
    uploadFilesRef,
    handleNodeAction,
    cancelVideoJob,
    retryNode,
    setGenerateError,
  } = ctx;

  const onMenuInsert = useCallback(
    (kind: InsertKind) => {
      if (!menu) return;
      const currentMenu = menu;
      setMenu(null);
      const width = kind === "text" ? 200 : 256;
      const height = kind === "text" ? 48 : 200;
      const node: CanvasNode = {
        id: `n_${Math.random().toString(36).slice(2, 10)}`,
        type: kind,
        // IK55VH：仅文本卡走 findPlacement 网格（菜单点锚，不重叠）；媒体保持菜单点精确落位
        position:
          kind === "text"
            ? findPlacement({
                existing: existingRects(),
                anchor: { x: currentMenu.x, y: currentMenu.y },
                nodeWidth: width,
                nodeHeight: height,
              })
            : {
                x: currentMenu.x - width / 2,
                y: currentMenu.y - height / 2,
              },
        width,
        height,
        data: { kind },
      };
      addNodeFull(node);
      const targetHandle = kind === "text" ? undefined : "prompt";
      if (currentMenu.source && targetHandle) {
        addEdgeFull({
          id: `e_${currentMenu.source}_${node.id}`,
          source: currentMenu.source,
          target: node.id,
          sourceHandle: currentMenu.sourceHandle,
          targetHandle,
        });
      }
    },
    [addEdgeFull, addNodeFull, existingRects, menu, setMenu],
  );

  const handleCanvasNodeAction = useCallback(
    (nodeId: string, actionId: string) => {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (node) handleNodeAction(node, actionId);
    },
    [handleNodeAction, nodes],
  );

  // IK55VL：视频卡生成中取消入口——按节点持久 taskId 取消（刷新后也可用）
  const handleNodeCancelJob = useCallback(
    (nodeId: string) => {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      const taskId = Number(node?.data.taskId);
      if (Number.isSafeInteger(taskId) && taskId > 0) cancelVideoJob(taskId);
    },
    [cancelVideoJob, nodes],
  );

  const handleNodeRetry = useCallback(
    (nodeId: string) => {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return;
      // 上传失败卡：用留存的 File 原地重传（不新建节点）；生成失败卡走下方 retryNode 后端重试
      const entry = uploadFilesRef.current.get(nodeId);
      if (node.data.recipe?.origin === "uploaded" && entry) {
        const pending = uploadMediaToCanvas({
          file: entry.file,
          projectId: Number(projectId),
          existingNodeId: nodeId,
          previewUrl: entry.previewUrl,
          addNode,
          patchNode,
          resizeNode,
          addAsset,
          onError: setGenerateError,
        });
        void pending.then((result) => {
          if (result.asset) {
            URL.revokeObjectURL(entry.previewUrl);
            uploadFilesRef.current.delete(nodeId);
          }
        });
        return;
      }
      // 生成失败：调后端 retry（仅终态失败 job 有效）→ 节点回 running + 续轮询；不再只是重开 dock。
      void retryNode(nodeId);
    },
    [
      addAsset,
      addNode,
      nodes,
      patchNode,
      projectId,
      resizeNode,
      retryNode,
      setGenerateError,
      uploadFilesRef,
    ],
  );

  /** 上传错误卡「移除」：删节点 + 清留存的 File/预览 URL。 */
  const handleNodeRemove = useCallback(
    (nodeId: string) => {
      const entry = uploadFilesRef.current.get(nodeId);
      if (entry) {
        URL.revokeObjectURL(entry.previewUrl);
        uploadFilesRef.current.delete(nodeId);
      }
      onNodesChange([{ type: "remove", id: nodeId }]);
    },
    [onNodesChange, uploadFilesRef],
  );

  const handleNodeMenuOpen = useCallback(
    (payload: CanvasMenuPayload & { nodeId: string }) => {
      setMenu(null);
      const clickedSelected = nodes.some(
        (node) => node.id === payload.nodeId && isNodeSelected(node),
      );
      const targetIds = clickedSelected
        ? nodes.filter(isNodeSelected).map((node) => node.id)
        : [payload.nodeId];
      setNodeMenu({
        screenX: payload.screenX,
        screenY: payload.screenY,
        targetIds,
      });
    },
    [nodes, setMenu, setNodeMenu],
  );

  const handleCardGenerated = useCallback(
    (card: CardMessage) => {
      const fields = cardToV2ImageFields(card);
      addNode("image", {
        width: fields.width,
        height: fields.height,
        data: {
          content: fields.content,
          recipe: { origin: "generated" },
        },
      });
    },
    [addNode],
  );

  const textMentionItems = useMemo(
    () =>
      nodes
        .filter(
          (node) =>
            node.data.kind === "image" ||
            node.data.kind === "video" ||
            node.data.kind === "audio",
        )
        .map((node) => ({
          id: node.id,
          type: node.data.kind as "image" | "video" | "audio",
          name: (node.data.content as string) || "未命名素材",
          assetId: node.data.assetId,
        })),
    [nodes],
  );

  const pickableCount = nodes.filter(
    (node) =>
      node.data.assetId &&
      node.data.status !== "running" &&
      node.data.status !== "error",
  ).length;

  // IK55VX：mock 快照 asset 持久化重载后再水合（画布 JSON 只存 id,src 从 mock 注册表确定性重建）
  useEffect(() => {
    for (const node of nodes) {
      // IK55VZ:商品卡多图(imageAssetIds)与单图参考卡(referenceAssetId)同通道水合
      const ids = [
        ...(node.data.referenceAssetId ? [node.data.referenceAssetId] : []),
        ...(node.data.imageAssetIds ?? []),
      ];
      for (const id of ids) {
        if (!id.startsWith("libimg-") || assets[id]) continue;
        const asset = getCardLibraryAsset(id);
        if (asset) {
          addAsset({
            id,
            kind: "image",
            src: asset.src,
            source: "uploaded",
          });
        }
      }
    }
    // IK55VZ:链接导入图(impimg-)按 sourceUrl 确定性重建缺失 asset
    for (const asset of productImportHydrationAssets(nodes, assets)) {
      addAsset(asset);
    }
  }, [addAsset, assets, nodes]);

  return {
    handleCanvasNodeAction,
    handleCardGenerated,
    handleNodeCancelJob,
    handleNodeMenuOpen,
    handleNodeRemove,
    handleNodeRetry,
    onMenuInsert,
    pickableCount,
    textMentionItems,
  };
}
