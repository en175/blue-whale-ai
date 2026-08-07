// IK74V6：左侧工具栏、悬浮菜单与卡片库导入（从 CanvasProjectRuntime 下沉）。
import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { UPLOAD_ACCEPT } from "@/lib/uploadRules";
import { REFERENCE_CARD_WIDTH, referenceCardHeight } from "../constants";
import { cloneCardSnapshot, getCardLibraryAsset, snapshotToNodeData, type CardLibraryItem } from "../cardLibrary";
import { newProductCardData, type Asset, type CanvasNode, type ReferenceCardType } from "../model";
import type { AddCanvasNode } from "./use-add-node";

type FlyoutAnchorSetter = Dispatch<SetStateAction<HTMLButtonElement | null>>;

export interface ToolbarActionsCtx {
  nodes: CanvasNode[];
  addNode: AddCanvasNode;
  openFilePicker: (accept: string) => void;
  bottomDockMode: "image" | "video" | "audio";
  referenceGenTargetRef: MutableRefObject<string | null>;
  setToolMode: Dispatch<SetStateAction<import("../v2/toolMode").ToolMode>>;
  setAudioFlyoutAnchor: FlyoutAnchorSetter;
  setAssetFlyoutAnchor: FlyoutAnchorSetter;
  setProductFlyoutAnchor: FlyoutAnchorSetter;
  setBottomDockMode: Dispatch<SetStateAction<"image" | "video" | "audio">>;
  setIsBottomDockOpen: Dispatch<SetStateAction<boolean>>;
  setAudioModeSignal: Dispatch<SetStateAction<{ nonce: number; subMode: "audio" | "music" }>>;
  setCardPickerOpen: Dispatch<SetStateAction<boolean>>;
  setCardPickerFilter: Dispatch<SetStateAction<ReferenceCardType[] | undefined>>;
  setPickingFor: Dispatch<SetStateAction<"image" | "video" | "audio" | "firstFrame" | "lastFrame" | "audioRef" | "audioImageRef" | null>>;
  addAsset: (asset: Asset) => void;
}

export function useToolbarActions(ctx: ToolbarActionsCtx) {
  const {
    nodes,
    addNode,
    openFilePicker,
    bottomDockMode,
    referenceGenTargetRef,
    setToolMode,
    setAudioFlyoutAnchor,
    setAssetFlyoutAnchor,
    setProductFlyoutAnchor,
    setBottomDockMode,
    setIsBottomDockOpen,
    setAudioModeSignal,
    setCardPickerOpen,
    setCardPickerFilter,
    setPickingFor,
    addAsset,
  } = ctx;
  const lastTextAddAtRef = useRef(0);
  const handleToolClick = useCallback(
    (id: string, element?: HTMLButtonElement) => {
      if (id === "select") {
        setToolMode((mode) => (mode === "mouse" ? "hand" : "mouse"));
      } else if (id === "upload") {
        openFilePicker(UPLOAD_ACCEPT);
      } else if (id === "audio") {
        setAudioFlyoutAnchor((anchor) => (anchor ? null : (element ?? null)));
      } else if (id === "asset-library") {
        setAssetFlyoutAnchor((anchor) => (anchor ? null : (element ?? null)));
      } else if (id === "product-card") {
        setProductFlyoutAnchor((anchor) => (anchor ? null : (element ?? null)));
      } else if (id === "ai-image") {
        referenceGenTargetRef.current = null;
        setBottomDockMode("image");
        setIsBottomDockOpen((open) => (bottomDockMode === "image" && open ? false : true));
      } else if (id === "ai-video") {
        setBottomDockMode("video");
        setIsBottomDockOpen((open) => (bottomDockMode === "video" && open ? false : true));
      } else if (id === "text") {
        const now = Date.now();
        if (now - lastTextAddAtRef.current < 400) return;
        lastTextAddAtRef.current = now;
        addNode("text");
      }
    },
    [addNode, bottomDockMode, openFilePicker, referenceGenTargetRef, setAssetFlyoutAnchor, setAudioFlyoutAnchor, setBottomDockMode, setIsBottomDockOpen, setProductFlyoutAnchor, setToolMode],
  );
  const handleAudioFlyoutSelect = useCallback(
    (subMode: "audio" | "music") => {
      setAudioFlyoutAnchor(null);
      setBottomDockMode("audio");
      setAudioModeSignal((signal) => ({ nonce: signal.nonce + 1, subMode }));
      setIsBottomDockOpen(true);
    },
    [setAudioFlyoutAnchor, setAudioModeSignal, setBottomDockMode, setIsBottomDockOpen],
  );
  const addEmptyProductCard = useCallback(() => {
    addNode("reference", {
      width: REFERENCE_CARD_WIDTH,
      height: referenceCardHeight("product"),
      data: newProductCardData(nodes),
    });
  }, [addNode, nodes]);
  const handleAssetFlyoutSelect = useCallback(
    (id: string) => {
      setAssetFlyoutAnchor(null);
      if (id === "import") {
        setCardPickerFilter(undefined);
        setCardPickerOpen(true);
        return;
      }
      const cardType = id as ReferenceCardType;
      if (cardType === "product") {
        addEmptyProductCard();
        return;
      }
      addNode("reference", {
        width: REFERENCE_CARD_WIDTH,
        height: referenceCardHeight(cardType),
        data: { cardType },
      });
    },
    [addEmptyProductCard, addNode, setAssetFlyoutAnchor, setCardPickerFilter, setCardPickerOpen],
  );
  const handleProductFlyoutSelect = useCallback(
    (id: string) => {
      setProductFlyoutAnchor(null);
      if (id === "new") {
        addEmptyProductCard();
        return;
      }
      if (id === "import") {
        setCardPickerFilter(["product"]);
        setCardPickerOpen(true);
      }
    },
    [addEmptyProductCard, setCardPickerFilter, setCardPickerOpen, setProductFlyoutAnchor],
  );
  const handleCardLibraryImport = useCallback(
    (item: CardLibraryItem) => {
      const snapshot = cloneCardSnapshot(item);
      const assetIds = [...(snapshot.referenceAssetId ? [snapshot.referenceAssetId] : []), ...(snapshot.imageAssetIds ?? [])];
      for (const id of assetIds) {
        const asset = getCardLibraryAsset(id);
        if (asset) addAsset({ id, kind: "image", src: asset.src, source: "uploaded" });
      }
      addNode("reference", {
        width: REFERENCE_CARD_WIDTH,
        height: referenceCardHeight(snapshot.cardType),
        data: snapshotToNodeData(snapshot),
      });
      setCardPickerOpen(false);
    },
    [addAsset, addNode, setCardPickerOpen],
  );
  const handlePickAudioSlot = useCallback(
    (slot: "audioRef" | "audioImageRef") => {
      setPickingFor(slot);
    },
    [setPickingFor],
  );

  return {
    handleToolClick,
    handleAudioFlyoutSelect,
    handleAssetFlyoutSelect,
    handleProductFlyoutSelect,
    handleCardLibraryImport,
    handlePickAudioSlot,
  };
}
