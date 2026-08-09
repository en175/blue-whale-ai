"use client";

// IK74V6：参考卡节点（从 nodes.tsx 下沉）。
/**
 * v2 节点组件 —— 复刻老 CanvasNodes 展示（VideoPlayer/MediaStateBody/节点/NodeToolbar/resize），
 * 数据源切 store（assetId 查 assets.src）。样式 CSS 类与老一致（DESIGN token）。
 */
"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  AtSign,
  AudioLines,
  Image as ImageIcon,
  Info,
  Loader2,
  Music,
  Package,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Upload,
  Video as VideoIcon,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  Handle,
  NodeResizer,
  NodeToolbar,
  Position,
  useHandleConnections,
  useNodesData,
  type NodeProps,
} from "@xyflow/react";
import { useCanvasStore } from "../store";
import type {
  CanvasNode,
  CanvasNodeData,
  NodeKindId,
  NodeOrigin,
  NodeStatus,
  MediaKind,
} from "../model";
import { richDocToPlainText, isEmptyRichDoc } from "../model";
import { nodeKinds } from "../kinds";
import {
  REFERENCE_CARD_TYPES,
  REFERENCE_CARD_WIDTH,
  referenceCardHeight,
} from "../constants";
import type { ReferenceCardType } from "../model";
import {
  NODE_TOOLBAR_ACTIONS,
  NODE_TOOLBAR_VIDEO_ACTIONS,
  toolbarForKind,
  type NodeToolbarAction,
} from "../config";
import { AuthenticatedImage } from "../components/AuthenticatedImage";
import { UploadCardBody } from "./uploadCard";
import {
  ProductDetailSection,
  ProductImageSection,
  ProductLinkImportSection,
} from "./product-card-sections";
import { useInlineEdit } from "./useInlineEdit";
import { EditorContent } from "@tiptap/react";
import { useRichEditor, plainTextToDoc } from "./text/RichTextEditor";
import { TextFormatToolbar } from "./text/TextFormatToolbar";
import { ExpandModal } from "./text/ExpandModal";
import type { TextMentionItem } from "./text/types";
import { NodeActionsContext, NodeHandles } from "./node-shared";

export function ReferenceNode({ id, data, width, selected }: NodeProps) {
  const d = data as unknown as CanvasNodeData;
  const cardType: ReferenceCardType = d.cardType ?? "custom";
  const meta =
    REFERENCE_CARD_TYPES.find((t) => t.id === cardType) ??
    REFERENCE_CARD_TYPES[REFERENCE_CARD_TYPES.length - 1];
  const {
    onAction,
    onEditDescription,
    onEditReferenceName,
    onUploadReferenceImage,
    onGenerateReferenceImage,
    onRemoveReferenceImage,
    referenceDropTargetId,
    onEditProductDetail,
    onRemoveProductImage,
    onImportProductLink,
  } = useContext(NodeActionsContext);
  const refAsset = useCanvasStore((s) =>
    d.referenceAssetId ? s.assets[d.referenceAssetId] : undefined,
  );
  /** IK55VZ 商品卡多图:imageAssetIds → store.assets 解析 src(整 map 选择,引用稳定)。 */
  const assetsMap = useCanvasStore((s) => s.assets);
  /** IK5JV6:描述/卡名内联编辑共用 useInlineEdit(Esc 取消/失焦保存)。 */
  const descEdit = useInlineEdit((text) => onEditDescription?.(id, text));
  const nameEdit = useInlineEdit((text) => onEditReferenceName?.(id, text));
  const [replaceMenuOpen, setReplaceMenuOpen] = useState(false);
  /** IK55VZ 商品卡 chrome 悬停态(selected || hovered 浮出「商品」标签 + 「@ 添加到对话」胶囊)。 */
  const [hovered, setHovered] = useState(false);
  const hasImage = !!d.referenceAssetId;
  const description = d.description ?? "";
  const emptyDesc = description.trim() === "";
  /** 描述区存在条件：有参考图，或删图后留有历史描述（全新空卡无描述区）。 */
  const showDescription = hasImage || !emptyDesc;
  const name = d.name ?? meta.label;
  const isCharacter = cardType === "character";
  const isProduct = cardType === "product";
  const productImages = (d.imageAssetIds ?? []).map((aid) => ({
    id: aid,
    src: assetsMap[aid]?.src,
  }));
  const dropHighlight = referenceDropTargetId === id;
  const cardWidth = width ?? REFERENCE_CARD_WIDTH;
  const aspect = d.referenceImageAspect;
  return (
    <>
      {/* chrome：选中时顶部居中 @ 按钮（点击走引用管道 mention，等价右键「添加到聊天」）；商品卡用自己的浮出层(见下) */}
      {!isProduct && (
        <NodeToolbar position={Position.Top} offset={8} isVisible={selected}>
          <button
            type="button"
            aria-label="引用卡片"
            className="nodrag flex items-center justify-center rounded-full"
            style={{
              width: 28,
              height: 28,
              background: "var(--tc-bg-elevated)",
              border: "1px solid var(--tc-border-subtle)",
              color: "var(--tc-text-secondary)",
            }}
            onClick={() => onAction?.(id, "mention")}
          >
            <AtSign width={13} height={13} />
          </button>
        </NodeToolbar>
      )}
      {/* IK55VZ 商品卡 chrome(原型定稿):选中或悬停浮出——左上「商品」标签 + 居中「@ 添加到对话」胶囊(点击走引用管道 mention) */}
      {isProduct && (
        <div
          data-testid="product-chrome"
          className="nodrag absolute -top-10 right-0 left-0 z-10 flex items-center transition-opacity duration-150"
          style={{
            opacity: selected || hovered ? 1 : 0,
            pointerEvents: selected || hovered ? "auto" : "none",
          }}
        >
          <span
            className="flex items-center gap-1 text-xs"
            style={{ color: "var(--tc-text-secondary)" }}
          >
            <Package width={12} height={12} />
            商品
          </span>
          <button
            type="button"
            aria-label="@ 添加到对话"
            className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
            style={{
              background: "var(--tc-bg-elevated)",
              border: "1px solid var(--tc-border-subtle)",
              color: "var(--tc-text-secondary)",
              boxShadow: "var(--tc-chrome-float-shadow)",
            }}
            onClick={() => onAction?.(id, "mention")}
          >
            <AtSign width={12} height={12} />
            添加到对话
          </button>
        </div>
      )}
      <div
        className="tc-reference-node relative flex flex-col overflow-hidden rounded-xl"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        style={{
          width: cardWidth,
          // 已填态高度内容驱动（图高随宽高比）；空/留史态用默认卡高；
          // IK55VZ 商品卡:内容驱动 + minHeight 兜底(新建落点 560)。
          // 禁用 RF NodeProps.height:它是 measured 回读(CanvasSurface 剥离 node.height 后
          // 首测前为 0),钉进内联样式会形成 0→测得 2px→钉 2px 的自反馈塌缩环。
          height: isProduct
            ? undefined
            : hasImage
              ? undefined
              : referenceCardHeight(cardType),
          minHeight: isProduct ? referenceCardHeight(cardType) : undefined,
          outline: dropHighlight
            ? "2px solid var(--tc-accent)"
            : selected
              ? "2px solid var(--tc-card-selected-stroke)"
              : "2px solid transparent",
          outlineOffset: 0,
          border: "1px solid var(--tc-border-subtle)",
          background: "var(--tc-bg-surface)",
        }}
      >
        <NodeHandles kind="reference" />
        {/* 头部:@ 圆 chip + 卡名（默认=类型名，双击改名）；商品卡按原型 28px chip + 大号粗体 */}
        <div className="flex items-center gap-2 px-3 pt-3">
          <span
            className="flex shrink-0 items-center justify-center rounded-full"
            style={{
              width: isProduct ? 28 : 20,
              height: isProduct ? 28 : 20,
              background: "var(--tc-bg-elevated)",
              color: "var(--tc-text-tertiary)",
            }}
          >
            <AtSign width={isProduct ? 14 : 11} height={isProduct ? 14 : 11} />
          </span>
          {nameEdit.editing ? (
            <input
              autoFocus
              defaultValue={name}
              className={`nodrag nowheel w-full bg-transparent outline-none ${
                isProduct ? "text-base font-bold" : "text-sm font-semibold"
              }`}
              style={{ color: "var(--tc-text-primary)" }}
              onBlur={nameEdit.handleBlur}
              onKeyDown={(e) => {
                nameEdit.handleKeyDown(e);
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
            />
          ) : (
            <span
              onDoubleClick={nameEdit.startEditing}
              className={`truncate ${
                isProduct ? "text-base font-bold" : "text-sm font-semibold"
              }`}
              style={{ color: "var(--tc-text-primary)", cursor: "text" }}
            >
              {name}
            </span>
          )}
        </div>

        {isProduct ? (
          /* IK55VZ 商品卡:图片区 + 详情区 + 「从商品链接导入」折叠区(原型纵向三段);
             不渲染单图槽/三按钮空态/替换菜单 */
          <>
            <ProductImageSection
              images={productImages}
              onAdd={() => onUploadReferenceImage?.(id)}
              onRemove={(assetId) => onRemoveProductImage?.(id, assetId)}
            />
            <ProductDetailSection
              detail={d.detail ?? ""}
              placeholder={meta.placeholder}
              onCommit={(text) => onEditProductDetail?.(id, text)}
            />
            <div
              className="mx-3 mt-2"
              style={{ borderTop: "1px solid var(--tc-border-subtle)" }}
            />
            <ProductLinkImportSection
              initialUrl={d.sourceUrl}
              onImport={(url) => onImportProductLink?.(id, url)}
            />
          </>
        ) : (
          <>
            {/* 描述区（有图或留史时存在）：顶部左对齐，双击就地编辑 */}
            {showDescription &&
              (descEdit.editing ? (
                <textarea
                  autoFocus
                  defaultValue={description}
                  placeholder={meta.placeholder}
                  rows={3}
                  onBlur={descEdit.handleBlur}
                  onKeyDown={descEdit.handleKeyDown}
                  className="nodrag nowheel mx-3 mt-2 resize-none bg-transparent text-xs leading-normal outline-none"
                  style={{ color: "var(--tc-text-primary)" }}
                />
              ) : (
                <div
                  onDoubleClick={descEdit.startEditing}
                  className="mx-3 mt-2 text-xs leading-normal"
                  style={{
                    color: emptyDesc
                      ? "var(--tc-text-muted)"
                      : "var(--tc-text-primary)",
                    whiteSpace: "pre-wrap",
                    cursor: "text",
                  }}
                >
                  {emptyDesc ? meta.placeholder : description}
                </div>
              ))}
            {showDescription && (
              <div
                className="mx-3 mt-2"
                style={{ borderTop: "1px solid var(--tc-border-subtle)" }}
              />
            )}

            {hasImage ? (
              /* 已填态：大图（宽撑满、高按宽高比、不裁剪）+ 悬停替换/删除 */
              <div className="px-3 pb-3 pt-2">
                <div
                  className="group relative overflow-hidden rounded-lg"
                  style={{
                    border: "1px solid var(--tc-border-subtle)",
                    background: "var(--tc-bg-elevated)",
                  }}
                >
                  {refAsset?.src ? (
                    // eslint-disable-next-line @next/next/no-img-element -- asset src 为签名 URL，不交 next/image 优化器
                    <img
                      src={refAsset.src}
                      alt={name}
                      className="nodrag block w-full"
                      style={{
                        aspectRatio: aspect ? String(aspect) : undefined,
                        objectFit: aspect ? "cover" : undefined,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        aspectRatio: aspect ? String(aspect) : "16/9",
                      }}
                    />
                  )}
                  <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    <button
                      type="button"
                      aria-label="替换参考图"
                      className="nodrag flex items-center justify-center rounded-md"
                      style={{
                        width: 24,
                        height: 24,
                        background: "var(--tc-bg-elevated)",
                        border: "1px solid var(--tc-border-subtle)",
                        color: "var(--tc-text-secondary)",
                      }}
                      onClick={() => setReplaceMenuOpen((v) => !v)}
                    >
                      <RefreshCw width={12} height={12} />
                    </button>
                    <button
                      type="button"
                      aria-label="删除参考图"
                      className="nodrag flex items-center justify-center rounded-md"
                      style={{
                        width: 24,
                        height: 24,
                        background: "var(--tc-bg-elevated)",
                        border: "1px solid var(--tc-border-subtle)",
                        color: "var(--tc-text-secondary)",
                      }}
                      onClick={() => onRemoveReferenceImage?.(id)}
                    >
                      <X width={12} height={12} />
                    </button>
                  </div>
                  {replaceMenuOpen && (
                    <div
                      role="menu"
                      className="nodrag absolute right-2 top-9 flex flex-col overflow-hidden rounded-md"
                      style={{
                        background: "var(--tc-bg-elevated)",
                        border: "1px solid var(--tc-border-subtle)",
                      }}
                    >
                      {(
                        [
                          {
                            icon: <Upload width={12} height={12} />,
                            label: "添加图片",
                            run: onUploadReferenceImage,
                          },
                          {
                            icon: <Sparkles width={12} height={12} />,
                            label: "生成图片",
                            run: onGenerateReferenceImage,
                          },
                        ] as const
                      ).map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          role="menuitem"
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs"
                          style={{ color: "var(--tc-text-secondary)" }}
                          onClick={() => {
                            setReplaceMenuOpen(false);
                            item.run?.(id);
                          }}
                        >
                          {item.icon}
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* 空卡/留史态：居中栈（占位文案仅全新空卡显示，静态不可编辑） */
              <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-5">
                <span
                  className="text-[13px]"
                  style={{ color: "var(--tc-text-secondary)" }}
                >
                  从画布拖入
                </span>
                {!showDescription && (
                  <span
                    className="text-center text-xs leading-normal"
                    style={{ color: "var(--tc-text-muted)" }}
                  >
                    {meta.placeholder}
                  </span>
                )}
                <div className="flex gap-2">
                  {(
                    [
                      {
                        icon: <Upload width={12} height={12} />,
                        label: "添加图片",
                        run: onUploadReferenceImage,
                      },
                      {
                        icon: <Sparkles width={12} height={12} />,
                        label: "生成图片",
                        run: onGenerateReferenceImage,
                      },
                    ] as const
                  ).map((b) => (
                    <button
                      key={b.label}
                      type="button"
                      className="nodrag flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs"
                      style={{
                        border: "1px solid var(--tc-border-subtle)",
                        background: "var(--tc-bg-elevated)",
                        color: "var(--tc-text-secondary)",
                      }}
                      onClick={() => b.run?.(id)}
                    >
                      {b.icon}
                      {b.label}
                    </button>
                  ))}
                </div>
                <span
                  className="flex items-center gap-1 text-[11px]"
                  style={{ color: "var(--tc-text-muted)" }}
                >
                  <Info width={10} height={10} />1 张参考图
                </span>
              </div>
            )}

            {/* character 独有:音色区（mock：常显虚线框，悬停展开上传态；选择器数据后续） */}
            {isCharacter && (
              <div
                className="px-3 pb-3 pt-2"
                style={{ borderTop: "1px solid var(--tc-border-subtle)" }}
              >
                <div
                  className="mb-1.5 flex items-center gap-1 text-[11px]"
                  style={{ color: "var(--tc-text-tertiary)" }}
                >
                  <Music width={11} height={11} />
                  音色
                </div>
                <div className="group">
                  <div
                    className="flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs group-hover:hidden"
                    style={{
                      border: "1px dashed var(--tc-border-subtle)",
                      background: "var(--tc-bg-elevated)",
                      color: "var(--tc-text-tertiary)",
                    }}
                  >
                    <Music width={12} height={12} />
                    设置角色音色
                  </div>
                  <div
                    className="hidden flex-col items-center justify-center gap-1.5 rounded-lg px-2 py-2 group-hover:flex"
                    style={{
                      border: "1px dashed var(--tc-border-subtle)",
                      background: "var(--tc-bg-elevated)",
                      color: "var(--tc-text-tertiary)",
                    }}
                  >
                    <span className="text-xs">从画布拖入音频</span>
                    <button
                      type="button"
                      className="nodrag flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs"
                      style={{
                        border: "1px solid var(--tc-border-subtle)",
                        color: "var(--tc-text-secondary)",
                      }}
                    >
                      <Upload width={12} height={12} />
                      上传音色音频
                    </button>
                    <span className="text-[10px]">2–15.2 秒 · 建议 ≤ 5 秒</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
