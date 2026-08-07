"use client";

import type { ChangeEventHandler, ComponentProps, RefObject } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ReactFlowProvider } from "@xyflow/react";

import { IMAGE_UPLOAD_ACCEPT, UPLOAD_ACCEPT } from "@/lib/uploadRules";
import type { Asset } from "../model";
import type { SaveState } from "../v2/useCanvasDoc";
import type { CanvasNodeMenu } from "../runtime/use-node-clipboard";
import type { PickingTarget } from "../runtime/use-canvas-picking";
import type { MenuPayload } from "../v2/CanvasSurface";
import { CanvasSurface } from "../v2/CanvasSurface";
import { ContextMenu } from "../v2/ContextMenu";
import { NodeContextMenu } from "../v2/NodeContextMenu";
import {
  ASSET_LIBRARY_FLYOUT_ITEMS,
  AUDIO_FLYOUT_ITEMS,
  PRODUCT_FLYOUT_ITEMS,
} from "../config";
import { dockAccept, dockPickHint } from "../utils";
import { TopBar, TopBarCenter, TopBarRight } from "./TopBar";
import { LeftToolbar } from "./LeftToolbar";
import { ToolbarFlyout } from "./ToolbarFlyout";
import { CardLibraryPicker } from "./CardLibraryPicker";
import { NodeInfoModal } from "./NodeInfoModal";
import { ZoomControls } from "./ZoomControls";
import { BottomDock } from "./dock/BottomDock";
import { AgentChatPanel } from "./AgentChatPanel";
import { SceneCardPanel } from "../../_scene-card/SceneCardPanel";

const HYDRATION_RETRY_BUTTON_CLASS = [
  "inline-flex h-9 items-center rounded-full border border-[var(--tc-border)]",
  "bg-[var(--tc-bg-surface)] px-4 text-sm text-[var(--tc-text-secondary)]",
  "transition-colors hover:text-[var(--tc-text-primary)]",
].join(" ");

const FOOTER_BUTTON_CLASS = [
  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium",
  "text-white/70 backdrop-blur-md transition-colors hover:text-white",
].join(" ");

type ToolbarState = {
  left: ComponentProps<typeof LeftToolbar>;
  audioAnchor: HTMLButtonElement | null;
  assetAnchor: HTMLButtonElement | null;
  productAnchor: HTMLButtonElement | null;
  onAudioSelect: (id: "audio" | "music") => void;
  onAssetSelect: ComponentProps<typeof ToolbarFlyout>["onSelect"];
  onProductSelect: ComponentProps<typeof ToolbarFlyout>["onSelect"];
  onCloseAudio: () => void;
  onCloseAsset: () => void;
  onCloseProduct: () => void;
};

type MenuState = {
  canvas: MenuPayload | null;
  node: CanvasNodeMenu | null;
  onInsert: ComponentProps<typeof ContextMenu>["onInsert"];
  onNodeAction: ComponentProps<typeof NodeContextMenu>["onAction"];
  onCloseCanvas: () => void;
  onCloseNode: () => void;
};

type CardPickerState = {
  open: boolean;
  props: ComponentProps<typeof CardLibraryPicker>;
};

type PickingState = {
  target: PickingTarget;
  pickableCount: number;
  onExit: () => void;
};

type DockState = {
  mounted: boolean;
  visible: boolean;
  props: ComponentProps<typeof BottomDock>;
};

type SceneState = {
  open: boolean;
  backendReady: boolean;
  saveState: SaveState;
  onToggle: () => void;
  props: ComponentProps<typeof SceneCardPanel>;
};

type InfoState = {
  nodeId: string | null;
  assets: Record<string, Asset>;
  onClose: () => void;
};

export type CanvasRuntimeViewProps = {
  fileInputRef: RefObject<HTMLInputElement | null>;
  referenceImageInputRef: RefObject<HTMLInputElement | null>;
  onFileChange: ChangeEventHandler<HTMLInputElement>;
  onReferenceImageFileChange: ChangeEventHandler<HTMLInputElement>;
  topBar: ComponentProps<typeof TopBar>;
  isAgentOpen: boolean;
  onAgentToggle: () => void;
  containerRef: RefObject<HTMLDivElement | null>;
  canvas: ComponentProps<typeof CanvasSurface>;
  menus: MenuState;
  toolbar: ToolbarState;
  cardPicker: CardPickerState;
  picking: PickingState;
  dock: DockState;
  agentChat: ComponentProps<typeof AgentChatPanel>;
  scene: SceneState;
  info: InfoState;
};

export function ProjectUnavailableShell({
  loadError,
  onRetry,
}: {
  loadError: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-5 bg-black">
      <p className="text-sm" style={{ color: "var(--tc-text-secondary)" }}>
        {loadError ? "项目加载失败" : "项目不存在"}
      </p>
      {loadError && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm transition-colors"
          style={{
            background: "var(--tc-bg-surface)",
            border: "1px solid var(--tc-border-subtle)",
            color: "var(--tc-text-secondary)",
          }}
        >
          重试
        </button>
      )}
      <Link
        href="/canvas"
        className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm transition-colors"
        style={{
          background: "var(--tc-accent)",
          color: "var(--tc-on-accent)",
        }}
      >
        返回项目列表
      </Link>
    </div>
  );
}

export function HydrationErrorShell({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-5 bg-black">
      <p className="text-sm text-[var(--tc-text-secondary)]">画布加载失败</p>
      <button
        type="button"
        onClick={onRetry}
        className={HYDRATION_RETRY_BUTTON_CLASS}
      >
        重试
      </button>
      <Link
        href="/canvas"
        className="inline-flex h-9 items-center rounded-full bg-[var(--tc-accent)] px-4 text-sm text-[var(--tc-on-accent)]"
      >
        返回项目列表
      </Link>
    </div>
  );
}

export function CanvasRuntimeView({
  fileInputRef,
  referenceImageInputRef,
  onFileChange,
  onReferenceImageFileChange,
  topBar,
  isAgentOpen,
  onAgentToggle,
  containerRef,
  canvas,
  menus,
  toolbar,
  cardPicker,
  picking,
  dock,
  agentChat,
  scene,
  info,
}: CanvasRuntimeViewProps) {
  const infoNode = info.nodeId
    ? canvas.nodes.find((node) => node.id === info.nodeId)
    : undefined;
  const infoAsset = infoNode?.data.assetId
    ? info.assets[infoNode.data.assetId]
    : undefined;

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-black text-white">
      <input
        ref={fileInputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple
        className="sr-only"
        onChange={onFileChange}
        aria-hidden="true"
      />
      {/* IK55VT 参考卡「添加图片」专用 input（仅图片白名单，单选；accept 命令式设置） */}
      <input
        ref={referenceImageInputRef}
        type="file"
        accept={IMAGE_UPLOAD_ACCEPT}
        className="sr-only"
        onChange={onReferenceImageFileChange}
        aria-hidden="true"
      />
      <TopBar {...topBar} />
      <TopBarCenter />
      <TopBarRight isAgentOpen={isAgentOpen} onAgentToggle={onAgentToggle} />

      <ReactFlowProvider>
        <div ref={containerRef} className="absolute inset-0 z-0">
          <CanvasSurface
            {...canvas}
            picking={picking.target !== null}
            pickingAccept={
              picking.target ? dockAccept(picking.target) : undefined
            }
          />
        </div>
        <ZoomControls />
      </ReactFlowProvider>

      {menus.canvas && (
        <ContextMenu
          screenX={menus.canvas.screenX}
          screenY={menus.canvas.screenY}
          hasSource={!!menus.canvas.source}
          onInsert={menus.onInsert}
          onClose={menus.onCloseCanvas}
        />
      )}

      {menus.node && (
        <NodeContextMenu
          screenX={menus.node.screenX}
          screenY={menus.node.screenY}
          hideSaveToAssets={canvas.nodes
            .filter((node) => menus.node?.targetIds.includes(node.id))
            .every((node) => node.data.kind === "group")}
          onAction={menus.onNodeAction}
          onClose={menus.onCloseNode}
        />
      )}

      <LeftToolbar {...toolbar.left} />
      {/* 音频按钮悬浮列表（IK55VM）：音频生成/AI 音乐；资产库/商品卡后续票复用 ToolbarFlyout */}
      <ToolbarFlyout
        open={toolbar.audioAnchor !== null}
        anchor={toolbar.audioAnchor}
        items={AUDIO_FLYOUT_ITEMS}
        onSelect={(id) => toolbar.onAudioSelect(id as "audio" | "music")}
        onClose={toolbar.onCloseAudio}
        ariaLabel="音频功能"
      />
      {/* 资产库按钮悬浮列表（IK55VS）：共享资产(IK55VX 卡片库选择器) + 五类参考卡空卡新建 */}
      <ToolbarFlyout
        open={toolbar.assetAnchor !== null}
        anchor={toolbar.assetAnchor}
        items={ASSET_LIBRARY_FLYOUT_ITEMS}
        onSelect={toolbar.onAssetSelect}
        onClose={toolbar.onCloseAsset}
        ariaLabel="资产库"
      />
      {/* 商品卡按钮悬浮列表（IK55VZ）：新建商品(空卡) / 导入商品(卡片库选择器限 product) */}
      <ToolbarFlyout
        open={toolbar.productAnchor !== null}
        anchor={toolbar.productAnchor}
        items={PRODUCT_FLYOUT_ITEMS}
        onSelect={toolbar.onProductSelect}
        onClose={toolbar.onCloseProduct}
        ariaLabel="商品卡"
      />
      {/* 卡片库（共享资产）选择器（IK55VX）：导入=复制快照，编辑不回写库 */}
      {cardPicker.open && <CardLibraryPicker {...cardPicker.props} />}

      {picking.target && (
        <div
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2147483603,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 8px 6px 14px",
            borderRadius: 9999,
            background: "var(--tc-bg-surface)",
            border: "1px solid var(--tc-border-subtle)",
            boxShadow: "var(--tc-menu-pill-shadow)",
            backdropFilter: "blur(12px)",
            color: "var(--tc-text-secondary)",
            fontSize: 12,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: "var(--tc-accent)", fontWeight: 600 }}>
            从画布选择
          </span>
          <span style={{ color: "var(--tc-text-tertiary)" }}>
            {dockPickHint(picking.target, picking.pickableCount)}
          </span>
          <span style={{ color: "var(--tc-text-muted)" }}>·</span>
          <button
            type="button"
            onClick={picking.onExit}
            style={{
              padding: "2px 10px",
              borderRadius: 9999,
              border: "1px solid var(--tc-border-subtle)",
              background: "var(--tc-menu-item-hover)",
              color: "var(--tc-text-secondary)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            取消 · Esc
          </button>
        </div>
      )}

      {dock.mounted && (
        <div style={{ display: dock.visible ? "contents" : "none" }}>
          <BottomDock {...dock.props} />
        </div>
      )}

      <AgentChatPanel key={topBar.activeProject.id} {...agentChat} />

      {scene.open && (
        <div
          className="fixed left-4 top-[68px] z-[1200] flex max-h-[calc(100vh-180px)] w-[320px] flex-col overflow-y-auto rounded p-3"
          style={{
            background: "var(--tc-bg-surface)",
            border: "1px solid var(--tc-border-subtle)",
          }}
        >
          <SceneCardPanel key={topBar.activeProject.id} {...scene.props} />
        </div>
      )}

      <div className="absolute bottom-4 left-4 z-[400] flex items-center gap-2">
        <Link
          href="/"
          className={FOOTER_BUTTON_CLASS}
          style={{
            background: "var(--tc-bg-surface)",
            border: "1px solid var(--tc-menu-pill-border)",
          }}
        >
          <ArrowLeft width={14} height={14} />
          返回首页
        </Link>
        {scene.backendReady && (
          <button
            type="button"
            onClick={scene.onToggle}
            className={FOOTER_BUTTON_CLASS}
            style={{
              background: "var(--tc-bg-surface)",
              border: "1px solid var(--tc-menu-pill-border)",
            }}
          >
            场景卡
          </button>
        )}
        {scene.backendReady && scene.saveState !== "idle" && (
          <span className="text-xs" style={{ color: "var(--tc-text-muted)" }}>
            {scene.saveState === "saving" ? "保存中…" : "已保存"}
          </span>
        )}
      </div>

      {/* IK6M68：节点「信息」详情弹窗（消除空操作） */}
      {infoNode && (
        <NodeInfoModal
          node={infoNode}
          asset={infoAsset}
          onClose={info.onClose}
        />
      )}
    </div>
  );
}
