"use client";

// IK74V6：视频 Dock 顶部卡片（关闭按钮 + 媒体参考区 + 编辑器 + 参数控制条，从 VideoDockContent 下沉）。
/**
 * VideoDockContent —— AI 视频生成 Dock 表单（展示层，受控组件）
 * 承载视频提示词与模型/宽高比/分辨率/时长/数量/参考模式等完整配置。
 * 状态由 BottomDock 提升并以 props 受控传入，本组件仅负责渲染与回调。
 */
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Settings,
  Settings2,
  Video,
} from "lucide-react";
import { CreditIcon, IconClose, IconPlus } from "../../icons";
import { DockMediaThumb, FrameUploadButton } from "./parts";
import type { DockMediaItem, VideoGenerateSettings } from "../../types";

export interface VideoDockTopCardProps {
  onClose: () => void;
  refMode: { id: string; label: string };
  firstFrameUrl?: string | null;
  lastFrameUrl?: string | null;
  media: DockMediaItem[];
  onRemoveMedia?: (id: string) => void;
  onPreviewMedia?: (m: DockMediaItem) => void;
  onSwapFrames?: () => void;
  onFrameUpload?: (file: File, slot: "first" | "last") => void;
  onFrameClear?: (slot: "first" | "last") => void;
  onPickFrameFromCanvas?: (slot: "first" | "last") => void;
  supportsReferenceVideo: boolean;
  uploadMenuOpen: boolean;
  uploadKind: "image" | "video";
  refModeOpen: boolean;
  onOpenModelSettings: () => void;
  generating?: boolean;
  onGenerate?: (settings: VideoGenerateSettings) => void;
  mediaAddRef: React.RefObject<HTMLButtonElement | null>;
  placeholderRef: React.RefObject<HTMLButtonElement | null>;
  videoTriggerRef: React.RefObject<HTMLButtonElement | null>;
  plusRef: React.RefObject<HTMLButtonElement | null>;
  refModeRef: React.RefObject<HTMLDivElement | null>;
  modelSettingsRef: React.RefObject<HTMLButtonElement | null>;
  quantityRef: React.RefObject<HTMLDivElement | null>;
  onTriggerClick: (
    ref: React.RefObject<HTMLButtonElement | null>,
    kind?: "image" | "video",
  ) => void;
  editorRef: React.RefObject<HTMLDivElement | null>;
  isEmpty: boolean;
  onInput: () => void;
  selectedModel: { id: string; label: string };
  resolution: { id: string; label: string };
  aspectRatio: { id: string; label: string };
  duration: number;
  quantity: string;
  quantityOpen: boolean;
  onOpenRefMode: () => void;
  onToggleQuantity: () => void;
  onToggleAdvanced: () => void;
}

export function VideoDockTopCard(props: VideoDockTopCardProps) {
  const {
    onClose,
    refMode,
    firstFrameUrl,
    lastFrameUrl,
    media,
    onRemoveMedia = () => {},
    onPreviewMedia,
    onSwapFrames = () => {},
    onFrameUpload = () => {},
    onFrameClear = () => {},
    onPickFrameFromCanvas = () => {},
    supportsReferenceVideo,
    uploadMenuOpen,
    uploadKind,
    refModeOpen,
    onOpenModelSettings,
    generating = false,
    onGenerate,
    mediaAddRef,
    placeholderRef,
    videoTriggerRef,
    plusRef,
    refModeRef,
    modelSettingsRef,
    quantityRef,
    onTriggerClick,
    editorRef,
    isEmpty,
    onInput,
    selectedModel,
    resolution,
    aspectRatio,
    duration,
    quantity,
    quantityOpen,
    onOpenRefMode,
    onToggleQuantity,
    onToggleAdvanced,
  } = props;
  return (
    <>
      <div
        style={{
          flex: "1 1 0%",
          minHeight: 0,
          padding: "8px 8px 0px",
          display: "flex",
          flexDirection: "column",
          gap: 0,
          justifyContent: "flex-start",
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              width: "100%",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                borderRadius: 10,
                position: "relative",
              }}
            >
              <div
                style={{ position: "absolute", top: 0, right: 0, zIndex: 1 }}
              >
                <button
                  type="button"
                  aria-label="Close"
                  onClick={onClose}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    border: 0,
                    background: "transparent",
                    color: "var(--tc-dock-text-faint)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    transition: "background 100ms, color 100ms",
                    fontSize: 13,
                  }}
                >
                  <IconClose size={13} />
                </button>
              </div>

              {refMode.id === "first-last" ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    padding: "0px 32px 0px 4px",
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flex: "1 1 0%",
                      minWidth: 0,
                    }}
                  >
                    <FrameUploadButton
                      label="首帧"
                      previewUrl={firstFrameUrl ?? undefined}
                      onFile={(file) => onFrameUpload?.(file, "first")}
                      onClear={() => onFrameClear?.("first")}
                      onPick={() => onPickFrameFromCanvas?.("first")}
                    />
                    <button
                      type="button"
                      aria-label="交换首尾帧"
                      onClick={onSwapFrames}
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        border: 0,
                        outline: "none",
                        background: "var(--tc-menu-item-hover)",
                        color: "var(--tc-text-secondary)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        transition: "background 120ms, color 120ms",
                      }}
                    >
                      <ArrowLeftRight
                        width={13}
                        height={13}
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    </button>
                    <FrameUploadButton
                      label="尾帧"
                      previewUrl={lastFrameUrl ?? undefined}
                      onFile={(file) => onFrameUpload?.(file, "last")}
                      onClear={() => onFrameClear?.("last")}
                      onPick={() => onPickFrameFromCanvas?.("last")}
                    />
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    paddingLeft: 4,
                    paddingRight: 32,
                    minHeight: 44,
                    width: "100%",
                    boxSizing: "border-box",
                    flexWrap: "wrap",
                  }}
                >
                  {media.length > 0 ? (
                    <>
                      {media.map((m) => (
                        <DockMediaThumb
                          key={m.id}
                          item={m}
                          onRemove={onRemoveMedia}
                          onPreview={onPreviewMedia}
                        />
                      ))}
                      {/* 缩略图行末尾「继续添加」：上传图片/从画布选择（与占位按钮同菜单） */}
                      <div style={{ position: "relative", flexShrink: 0 }}>
                        <button
                          ref={mediaAddRef}
                          type="button"
                          aria-label="添加图片"
                          aria-haspopup="menu"
                          aria-expanded={
                            uploadMenuOpen && uploadKind === "image"
                          }
                          onClick={() => onTriggerClick(mediaAddRef)}
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 9,
                            border: "1px dashed var(--tc-dock-border-ghost)",
                            background: "var(--tc-dock-fill-ghost)",
                            color: "var(--tc-dock-text-hint)",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                            padding: 0,
                            cursor: "pointer",
                            opacity: 1,
                            transition: "background 120ms, color 120ms",
                            flexShrink: 0,
                          }}
                        >
                          <IconPlus size={15} />
                        </button>
                      </div>
                    </>
                  ) : (
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      <button
                        ref={placeholderRef}
                        type="button"
                        aria-label="参考图片"
                        aria-haspopup="menu"
                        aria-expanded={uploadMenuOpen}
                        onClick={() => onTriggerClick(placeholderRef)}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 9,
                          border: "1px solid var(--tc-dock-border-ghost)",
                          background: "var(--tc-dock-fill-ghost)",
                          color: "var(--tc-dock-text-hint)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                          padding: 0,
                          cursor: "pointer",
                          opacity: 1,
                          transition: "background 120ms, color 120ms",
                          flexShrink: 0,
                        }}
                      >
                        <ImageIcon
                          width={15}
                          height={15}
                          stroke="currentColor"
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                  )}
                  {supportsReferenceVideo && (
                    <>
                      <span
                        style={{
                          color: "var(--tc-dock-text-ghost)",
                          fontSize: 14,
                          lineHeight: 1,
                        }}
                      >
                        ·
                      </span>
                      <button
                        ref={videoTriggerRef}
                        type="button"
                        aria-label="参考视频"
                        aria-haspopup="menu"
                        aria-expanded={uploadMenuOpen && uploadKind === "video"}
                        onClick={() =>
                          onTriggerClick(videoTriggerRef, "video")
                        }
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 9,
                          border: "1px solid var(--tc-dock-border-ghost)",
                          background: "var(--tc-dock-fill-ghost)",
                          color: "var(--tc-dock-text-hint)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                          padding: 0,
                          cursor: "pointer",
                          opacity: 1,
                          transition: "background 120ms, color 120ms",
                          flexShrink: 0,
                        }}
                      >
                        <Video
                          width={15}
                          height={15}
                          stroke="currentColor"
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                      </button>
                    </>
                  )}
                </div>
              )}

              <div
                style={{ position: "relative", flex: "1 1 0%", minWidth: 0 }}
              >
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  className="tc-panel-textarea-scrollbar"
                  onInput={onInput}
                  style={{
                    width: "100%",
                    minHeight: 56,
                    maxHeight: 452,
                    overflowY: "auto",
                    padding: "6px 36px 6px 4px",
                    margin: 0,
                    borderWidth: "medium",
                    borderStyle: "none",
                    borderColor: "currentcolor",
                    borderImage: "initial",
                    background: "transparent",
                    color: "var(--tc-text-primary)",
                    fontSize: 14,
                    lineHeight: "22px",
                    outline: "none",
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                  }}
                />
                {isEmpty && (
                  <div
                    style={{
                      position: "absolute",
                      left: 4,
                      top: 6,
                      color: "var(--tc-dock-text-placeholder)",
                      fontSize: 14,
                      lineHeight: "22px",
                      pointerEvents: "none",
                      right: 36,
                    }}
                  >
                    {refMode.id === "first-last"
                      ? "请描述你想生成的视频内容。"
                      : "上传 3-10 秒视频片段，并结合文本或图片轻松修改内容、改变镜头角度或重塑原视频风格。可使用 @ 快速插入已添加资源。"}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          padding: "8px 8px 8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: "fit-content",
          flexShrink: 0,
          fontSize: 13,
          background: "transparent",
          position: "relative",
        }}
      >
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button
            ref={plusRef}
            type="button"
            aria-label="上传"
            aria-haspopup="menu"
            aria-expanded={uploadMenuOpen}
            onClick={() => onTriggerClick(plusRef)}
            style={{
              width: 24,
              height: 24,
              padding: 0,
              border: 0,
              borderRadius: "50%",
              background: "var(--tc-dock-fill)",
              color: "var(--tc-dock-text)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "background 120ms, color 120ms",
            }}
          >
            <IconPlus size={14} />
          </button>
        </div>

        <div ref={refModeRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => onOpenRefMode()}
            style={{
              height: 32,
              borderRadius: 8,
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "0px 8px",
              border: 0,
              background: "var(--tc-dock-control-bg, transparent)",
              color: "var(--tc-text-primary)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 200ms cubic-bezier(0.16, 1, 0.3, 1)",
              whiteSpace: "nowrap",
            }}
          >
            {refMode.label}
            <ChevronDown
              width={12}
              height={12}
              strokeWidth={2}
              aria-hidden="true"
              style={{
                opacity: 0.7,
                transform: refModeOpen ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 150ms",
              }}
            />
          </button>
        </div>

        <button
          ref={modelSettingsRef}
          type="button"
          onClick={() => onOpenModelSettings()}
          style={{
            height: 32,
            borderRadius: 8,
            boxSizing: "border-box",
            width: "max-content",
            minWidth: 224,
            maxWidth: 320,
            padding: "0px 8px",
            border: 0,
            background: "var(--tc-dock-control-bg, transparent)",
            color: "var(--tc-dock-text-strong)",
            fontSize: 12,
            lineHeight: "16px",
            fontWeight: 500,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            transition: "background 100ms",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              flexShrink: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: 4,
              justifyContent: "flex-start",
              paddingRight: 8,
            }}
          >
            <Settings2
              width={14}
              height={14}
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
              style={{ flexShrink: 0 }}
            />
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                textAlign: "left",
                fontSize: 12,
              }}
            >
              {selectedModel.label}
            </span>
          </div>
          <span
            aria-hidden="true"
            style={{
              width: 1,
              height: 8,
              flexShrink: 0,
              alignSelf: "center",
              background: "var(--tc-menu-item-hover)",
              borderRadius: 1,
            }}
          />
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0px 8px",
            }}
          >
            {aspectRatio.label}
          </div>
          <span
            aria-hidden="true"
            style={{
              width: 1,
              height: 8,
              flexShrink: 0,
              alignSelf: "center",
              background: "var(--tc-menu-item-hover)",
              borderRadius: 1,
            }}
          />
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0px 8px",
            }}
          >
            {resolution.label}
          </div>
          <span
            aria-hidden="true"
            style={{
              width: 1,
              height: 8,
              flexShrink: 0,
              alignSelf: "center",
              background: "var(--tc-menu-item-hover)",
              borderRadius: 1,
            }}
          />
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0px 8px",
            }}
          >
            {duration}s
          </div>
        </button>

        <button
          type="button"
          title="高级设置"
          onClick={() => onToggleAdvanced()}
          style={{
            height: 32,
            width: 32,
            borderRadius: 6,
            border: 0,
            background: "var(--tc-dock-control-bg, transparent)",
            color: "var(--tc-text-muted)",
            cursor: "pointer",
            display: "none",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 100ms, color 100ms",
            flexShrink: 0,
          }}
        >
          <Settings
            width={14}
            height={14}
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          />
        </button>

        <div style={{ flex: "1 1 0%" }} />

        <div ref={quantityRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={quantityOpen}
            aria-label="生成数量"
            onClick={() => onToggleQuantity()}
            style={{
              height: 32,
              borderRadius: 8,
              boxSizing: "border-box",
              width: 32,
              minWidth: 32,
              maxWidth: 32,
              padding: 0,
              border: 0,
              background: "var(--tc-dock-control-bg, transparent)",
              color: "var(--tc-dock-text-strong)",
              fontSize: 12,
              lineHeight: "16px",
              fontWeight: 500,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 100ms",
              flexShrink: 0,
              opacity: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            <span style={{ fontSize: 12, lineHeight: "16px", fontWeight: 600 }}>
              {quantity}
            </span>
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ position: "relative", display: "inline-flex" }}>
            <button
              type="button"
              disabled={isEmpty || generating}
              onClick={() =>
                onGenerate?.({
                  model: selectedModel,
                  resolution,
                  aspectRatio,
                  duration,
                  quantity,
                  refMode,
                })
              }
              style={{
                height: 32,
                padding: "0px 12px",
                borderRadius: "8px 0px 0px 8px",
                border: 0,
                fontSize: 12,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                transition: "120ms",
                background:
                  isEmpty || generating
                    ? "var(--tc-dock-fill-subtle)"
                    : "var(--tc-accent)",
                color:
                  isEmpty || generating
                    ? "var(--tc-dock-text-disabled)"
                    : "var(--tc-text-primary)",
                cursor: isEmpty || generating ? "default" : "pointer",
                opacity: 1,
              }}
            >
              <CreditIcon size={14} />
              <span
                style={{ fontSize: 12, fontWeight: 600, lineHeight: "16px" }}
              >
                15
              </span>
              <span
                style={{
                  lineHeight: "16px",
                  marginLeft: 2,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                生成
              </span>
            </button>
          </div>
          <button
            type="button"
            title="积分模式"
            style={{
              height: 32,
              width: 30,
              padding: 0,
              borderRadius: "0px 8px 8px 0px",
              borderWidth: "medium medium medium 1px",
              borderStyle: "none none none solid",
              borderColor:
                "currentcolor currentcolor currentcolor var(--tc-border-subtle)",
              borderImage: "initial",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "background 100ms, color 100ms",
              background: "var(--tc-dock-fill-subtle)",
              color: "var(--tc-dock-text-disabled)",
              cursor: "default",
            }}
          >
            <ChevronUp
              width={16}
              height={16}
              strokeWidth={2.25}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </>
  );
}
