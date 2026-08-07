// IK74V6：参考卡与商品卡 handlers（从 CanvasProjectRuntime 下沉）。
import { useCallback, useRef } from "react";
import { uploadAsset } from "@/lib/assets";
import { validateUploadFile } from "@/lib/uploadRules";
import {
  mergeProductImageIds,
  parseProductUrl,
  productImportImageId,
  productImportPatch,
} from "../productImport";
import { IMAGE_UPLOAD_ACCEPT } from "@/lib/uploadRules";
import type { Asset as CanvasAsset, CanvasNode, CanvasNodeData } from "../model";
import { probeImageAspect, userFriendlyErrorMessage } from "./runtime-lib";

export interface ReferenceCardCtx {
  pid: string;
  nodes: CanvasNode[];
  assets: Record<string, CanvasAsset>;
  patchNode: (id: string, patch: Partial<CanvasNodeData>, options?: { persist?: boolean }) => void;
  addAsset: (asset: CanvasAsset) => void;
  setGenerateError: (msg: string | null) => void;
  setBottomDockMode: React.Dispatch<React.SetStateAction<"image" | "video" | "audio">>;
  setIsBottomDockOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDockFocusSignal: React.Dispatch<React.SetStateAction<number>>;
  referenceGenTargetRef: React.MutableRefObject<string | null>;
  notifyError: (message: string) => void;
}

export function useReferenceCardHandlers(ctx: ReferenceCardCtx) {
  const {
    pid, nodes, assets, patchNode, addAsset, setGenerateError,
    setBottomDockMode, setIsBottomDockOpen, setDockFocusSignal,
    referenceGenTargetRef, notifyError,
  } = ctx;
  const handleRemoveReferenceImage = useCallback(
    (id: string) => {
      patchNode(id, {
        referenceAssetId: undefined,
        referenceImageAspect: undefined,
      });
    },
    [patchNode],
  );

  // IK55VT 通道一：画布图片素材拖放上卡落槽（宽高比取 asset 尺寸，回退节点框尺寸）
  const handleReferenceImageDrop = useCallback(
    (refNodeId: string, sourceNodeId: string) => {
      const source = nodes.find((n) => n.id === sourceNodeId);
      const assetId = source?.data.assetId;
      if (!source || !assetId) return;
      const target = nodes.find((n) => n.id === refNodeId);
      // IK55VZ 商品卡：追加进 imageAssetIds(≤8,满了不再追加)而非覆盖单槽
      if (target?.data.cardType === "product") {
        const merged = mergeProductImageIds(target.data.imageAssetIds, [
          assetId,
        ]);
        if (merged.length !== (target.data.imageAssetIds?.length ?? 0))
          patchNode(refNodeId, { imageAssetIds: merged });
        return;
      }
      const asset = assets[assetId];
      const aspect =
        asset?.width && asset.height
          ? asset.width / asset.height
          : source.width && source.height
            ? source.width / source.height
            : undefined;
      patchNode(refNodeId, {
        referenceAssetId: assetId,
        referenceImageAspect: aspect,
      });
    },
    [nodes, assets, patchNode],
  );

  // IK55VT 通道三：参考卡「生成图片」→ 武装目标 + 无预填开图像 Dock（结果回落卡槽，见 useCanvasGeneration）
  const handleGenerateReferenceImage = useCallback((id: string) => {
    referenceGenTargetRef.current = id;
    setBottomDockMode("image");
    setIsBottomDockOpen(true);
    setDockFocusSignal((n) => n + 1);
  }, [referenceGenTargetRef, setBottomDockMode, setDockFocusSignal, setIsBottomDockOpen]);

  // IK55VT 通道二：参考卡「添加图片」→ 隐藏 file input（仅图片白名单）→ uploadAsset 落槽（不建画布节点）
  const refImageInputRef = useRef<HTMLInputElement>(null);
  const pendingRefUploadNodeIdRef = useRef<string | null>(null);
  const handleUploadReferenceImage = useCallback((id: string) => {
    pendingRefUploadNodeIdRef.current = id;
    const input = refImageInputRef.current;
    if (!input) return;
    input.accept = IMAGE_UPLOAD_ACCEPT;
    input.click();
  }, [refImageInputRef]);
  const handleRefImageFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      const nodeId = pendingRefUploadNodeIdRef.current;
      pendingRefUploadNodeIdRef.current = null;
      if (!file || !nodeId || !pid) return;
      const validation = validateUploadFile(file);
      if (!validation.ok || validation.kind !== "image") {
        notifyError(validation.ok ? "仅支持图片格式" : validation.reason);
        return;
      }
      try {
        const result = await uploadAsset(file, Number(pid), "image");
        const assetId = String(result.id);
        addAsset({
          id: assetId,
          kind: "image",
          src: result.url,
          source: "uploaded",
        });
        // IK55VZ 商品卡:追加进 imageAssetIds(≤8)而非覆盖单槽(无需探测宽高比)
        const target = nodes.find((n) => n.id === nodeId);
        if (target?.data.cardType === "product") {
          patchNode(nodeId, {
            imageAssetIds: mergeProductImageIds(target.data.imageAssetIds, [
              assetId,
            ]),
          });
          return;
        }
        const aspect = await probeImageAspect(result.url);
        patchNode(nodeId, {
          referenceAssetId: assetId,
          referenceImageAspect: aspect,
        });
      } catch (err) {
        notifyError(userFriendlyErrorMessage(err));
      }
    },
    [pid, nodes, addAsset, notifyError, patchNode],
  );

  // IK55VZ 商品卡详情 commit：写回 detail
  const handleEditProductDetail = useCallback(
    (id: string, text: string) => {
      patchNode(id, { detail: text });
    },
    [patchNode],
  );

  // IK55VZ 商品卡移除单张图：从 imageAssetIds 摘除(asset 保留在 store,画布其他引用不受影响)
  const handleRemoveProductImage = useCallback(
    (id: string, assetId: string) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      patchNode(id, {
        imageAssetIds: (node.data.imageAssetIds ?? []).filter(
          (a) => a !== assetId,
        ),
      });
    },
    [nodes, patchNode],
  );

  // IK55VZ 商品卡链接导入:mock 解析 → 注册 4 张图 assets(确定性 id,刷新后可重建) →
  // 填充 imageAssetIds/detail/sourceUrl(名称仅当仍是「商品 N」自动编号或未填时才用解析名)
  const handleImportProductLink = useCallback(
    (id: string, url: string) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      const parsed = parseProductUrl(url);
      const newIds = parsed.images.map((src, i) => {
        const aid = productImportImageId(url, i);
        addAsset({ id: aid, kind: "image", src, source: "uploaded" });
        return aid;
      });
      patchNode(id, productImportPatch(node.data, parsed, url, newIds));
    },
    [nodes, addAsset, patchNode],
  );

  // IK55VH 富文本卡 @ 建议素材：画布内 image/video/audio 节点投影
  return {
    refImageInputRef,
    handleRemoveReferenceImage,
    handleReferenceImageDrop,
    handleGenerateReferenceImage,
    handleUploadReferenceImage,
    handleRefImageFileChange,
    handleEditProductDetail,
    handleRemoveProductImage,
    handleImportProductLink,
  };
}
