/**
 * VideoDockContent —— AI 视频生成 Dock 表单（展示层，受控组件）
 * 承载视频提示词与模型/宽高比/分辨率/时长/数量/参考模式等完整配置。
 * 状态由 BottomDock 提升并以 props 受控传入，本组件仅负责渲染与回调。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeftRight,
  AudioLines,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Settings,
  Settings2,
  Video,
} from "lucide-react";
import { AspectRatioIcon } from "@/components/icons/AspectRatioIcon";
import { CreditIcon, IconClose, IconPlus } from "../../icons";
import { VIDEO_ASPECT_RATIOS, REF_MODES, QUANTITIES } from "../../constants";
import type { VideoDockContentProps } from "../../types";
import { FrameUploadButton, MediaCategoryButton, MediaSection } from "./parts";
import { UploadSourceMenu } from "./UploadSourceMenu";

type MediaCategory = "image" | "video" | "audio";

const MEDIA_CATEGORY_SPECS: Record<MediaCategory, { label: string; spec: string; accept: string; uploadedMax: number }> = {
  image: { label: "图片", spec: "Max 9 images · 350×350 – 7680×7680", accept: "image/*", uploadedMax: 9 },
  video: {
    label: "视频",
    spec: "Max 3 videos · ≤15.2s total · ≥2s each · ≤50MB · ≤6000×6000",
    accept: "video/*",
    uploadedMax: 3,
  },
  audio: { label: "音频", spec: "Max 3 audios · ≤15.2s total · ≥2s each", accept: "audio/*", uploadedMax: 3 },
};

export function VideoDockContent(props: VideoDockContentProps) {
  const {
    editorRef,
    isEmpty,
    onInput,
    onClose,
    refMode,
    setRefMode,
    refModeOpen,
    setRefModeOpen,
    selectedModel,
    onSelectModel,
    modelSettingsOpen,
    setModelSettingsOpen,
    aspectRatio,
    setAspectRatio,
    resolution,
    setResolution,
    videoModels,
    duration,
    setDuration,
    quantity,
    setQuantity,
    quantityOpen,
    setQuantityOpen,
    advancedOpen,
    setAdvancedOpen,
    internetSearch,
    setInternetSearch,
    firstFrameUrl,
    lastFrameUrl,
    onFrameUpload,
    onFrameClear,
    onSwapFrames,
    media = [],
    onRemoveMedia,
    onLocalUpload,
    onPickFromCanvas,
    onExitPick,
    isPicking = false,
    onGenerate,
    generating = false,
  } = props;

  // 当前模型的 capability（DB 驱动）：下拉数据源 + 联动。比例用平台固定集合常量。
  const currentCap = videoModels.find((m) => m.modelId === selectedModel.id) ?? videoModels[0];
  const resolutions = currentCap?.supportedResolutions ?? [];
  const drMin = currentCap?.durationRange?.min ?? 4;
  const drMax = currentCap?.durationRange?.max ?? 15;
  const drStep = currentCap?.durationRange?.step ?? 1;
  const durationTicks = Array.from({ length: (drMax - drMin) / drStep + 1 }, (_, i) => drMin + i * drStep);

  // omni 全能参考：按类型从 media 收集 url（图片/视频/音频分别打 reference_image/reference_video/reference_audio）
  const collectRefs = (type: MediaCategory): string[] =>
    media.filter((m) => m.type === type).map((m) => m.src).filter((s): s is string => Boolean(s));

  // 上传来源菜单（参考图占位 + 加号共用）
  const localFileRef = useRef<HTMLInputElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const uploadTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);

  const openUploadMenuFrom = (ref: React.RefObject<HTMLButtonElement | null>) => {
    uploadTriggerRef.current = ref.current;
    setUploadMenuOpen(true);
  };
  const handleTriggerClick = (ref: React.RefObject<HTMLButtonElement | null>) => {
    if (isPicking) {
      onExitPick?.();
      return;
    }
    openUploadMenuFrom(ref);
  };
  const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onLocalUpload?.(file);
    e.target.value = "";
  };

  const refModeRef = useRef<HTMLDivElement>(null);
  const refModeMenuRef = useRef<HTMLDivElement>(null);
  const modelSettingsRef = useRef<HTMLButtonElement>(null);
  const modelSettingsMenuRef = useRef<HTMLDivElement>(null);
  const quantityRef = useRef<HTMLDivElement>(null);
  const quantityMenuRef = useRef<HTMLDivElement>(null);
  const mediaCategoryRefs = useRef<Record<MediaCategory, HTMLButtonElement | null>>({
    image: null,
    video: null,
    audio: null,
  });
  const mediaCategoryMenuRef = useRef<HTMLDivElement>(null);

  const [refModePos, setRefModePos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });
  const [modelSettingsPos, setModelSettingsPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });
  const [quantityPos, setQuantityPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });
  const [mediaCategoryPos, setMediaCategoryPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [resolutionDropdownOpen, setResolutionDropdownOpen] = useState(false);
  const [openMediaCategory, setOpenMediaCategory] = useState<MediaCategory | null>(null);

  useEffect(() => {
    if (refModeOpen && refModeRef.current) {
      const rect = refModeRef.current.getBoundingClientRect();
      setRefModePos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
    }
  }, [refModeOpen]);

  useEffect(() => {
    if (modelSettingsOpen && modelSettingsRef.current) {
      const rect = modelSettingsRef.current.getBoundingClientRect();
      setModelSettingsPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
    }
  }, [modelSettingsOpen]);

  useEffect(() => {
    if (quantityOpen && quantityRef.current) {
      const rect = quantityRef.current.getBoundingClientRect();
      setQuantityPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
    }
  }, [quantityOpen]);

  useEffect(() => {
    if (openMediaCategory && mediaCategoryRefs.current[openMediaCategory]) {
      const rect = mediaCategoryRefs.current[openMediaCategory]!.getBoundingClientRect();
      setMediaCategoryPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
    }
  }, [openMediaCategory]);

  useEffect(() => {
    if (!refModeOpen) return;
    const handle = (e: MouseEvent) => {
      const t = e.target as Node;
      if (refModeRef.current?.contains(t)) return;
      if (refModeMenuRef.current?.contains(t)) return;
      setRefModeOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [refModeOpen, setRefModeOpen]);

  useEffect(() => {
    if (!modelSettingsOpen) return;
    const handle = (e: MouseEvent) => {
      const t = e.target as Node;
      if (modelSettingsRef.current?.contains(t)) return;
      if (modelSettingsMenuRef.current?.contains(t)) return;
      setModelSettingsOpen(false);
      setModelDropdownOpen(false);
      setResolutionDropdownOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [modelSettingsOpen, setModelSettingsOpen]);

  useEffect(() => {
    if (!quantityOpen) return;
    const handle = (e: MouseEvent) => {
      const t = e.target as Node;
      if (quantityRef.current?.contains(t)) return;
      if (quantityMenuRef.current?.contains(t)) return;
      setQuantityOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [quantityOpen, setQuantityOpen]);

  useEffect(() => {
    if (!openMediaCategory) return;
    const handle = (e: MouseEvent) => {
      const t = e.target as Node;
      if (mediaCategoryRefs.current[openMediaCategory]?.contains(t)) return;
      if (mediaCategoryMenuRef.current?.contains(t)) return;
      setOpenMediaCategory(null);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [openMediaCategory]);

  return (
    <>
      <input
        ref={localFileRef}
        type="file"
        accept="image/*,video/*"
        className="sr-only"
        aria-hidden="true"
        onChange={handleLocalFileChange}
      />
      <UploadSourceMenu
        triggerRef={uploadTriggerRef}
        open={uploadMenuOpen}
        onClose={() => setUploadMenuOpen(false)}
        onLocalUpload={() => localFileRef.current?.click()}
        onPickFromCanvas={() => onPickFromCanvas?.()}
      />
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
          <div style={{ display: "flex", flexDirection: "column", gap: 0, width: "100%" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                borderRadius: 10,
                position: "relative",
              }}
            >
              <div style={{ position: "absolute", top: 0, right: 0, zIndex: 1 }}>
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
                    color: "rgba(255, 255, 255, 0.35)",
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
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 0%", minWidth: 0 }}>
                    <FrameUploadButton
                      label="首帧"
                      value={firstFrameUrl}
                      onPick={(f) => onFrameUpload?.(f, "first")}
                      onClear={() => onFrameClear?.("first")}
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
                        background: "rgba(255, 255, 255, 0.08)",
                        color: "rgba(255, 255, 255, 0.7)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        transition: "background 120ms, color 120ms",
                      }}
                    >
                      <ArrowLeftRight width={13} height={13} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <FrameUploadButton
                      label="尾帧"
                      value={lastFrameUrl}
                      onPick={(f) => onFrameUpload?.(f, "last")}
                      onClear={() => onFrameClear?.("last")}
                    />
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "0px 32px 0px 4px",
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                >
                  <MediaCategoryButton
                    triggerRef={(el) => {
                      mediaCategoryRefs.current.image = el;
                    }}
                    icon={<ImageIcon width={15} height={15} strokeWidth={2} aria-hidden="true" />}
                    label="图片"
                    active={openMediaCategory === "image"}
                    hasItems={media.some((m) => m.type === "image")}
                    onClick={() => setOpenMediaCategory((c) => (c === "image" ? null : "image"))}
                  />
                  <MediaCategoryButton
                    triggerRef={(el) => {
                      mediaCategoryRefs.current.video = el;
                    }}
                    icon={<Video width={15} height={15} strokeWidth={2} aria-hidden="true" />}
                    label="视频"
                    active={openMediaCategory === "video"}
                    hasItems={media.some((m) => m.type === "video")}
                    onClick={() => setOpenMediaCategory((c) => (c === "video" ? null : "video"))}
                  />
                  <MediaCategoryButton
                    triggerRef={(el) => {
                      mediaCategoryRefs.current.audio = el;
                    }}
                    icon={<AudioLines width={15} height={15} strokeWidth={2} aria-hidden="true" />}
                    label="音频"
                    active={openMediaCategory === "audio"}
                    hasItems={media.some((m) => m.type === "audio")}
                    onClick={() => setOpenMediaCategory((c) => (c === "audio" ? null : "audio"))}
                  />
                </div>
              )}

              <div style={{ position: "relative", flex: "1 1 0%", minWidth: 0 }}>
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
                    color: "rgb(255, 255, 255)",
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
                      color: "rgba(255, 255, 255, 0.3)",
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
            onClick={() => handleTriggerClick(plusRef)}
            style={{
              width: 24,
              height: 24,
              padding: 0,
              border: 0,
              borderRadius: "50%",
              background: "rgba(255, 255, 255, 0.07)",
              color: "rgba(255, 255, 255, 0.72)",
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
            onClick={() => setRefModeOpen(!refModeOpen)}
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
              color: "rgb(255, 255, 255)",
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
          onClick={() => setModelSettingsOpen(!modelSettingsOpen)}
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
            color: "rgba(255, 255, 255, 0.85)",
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
              background: "rgba(255, 255, 255, 0.08)",
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
              background: "rgba(255, 255, 255, 0.08)",
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
              background: "rgba(255, 255, 255, 0.08)",
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
          onClick={() => setAdvancedOpen(!advancedOpen)}
          style={{
            height: 32,
            width: 32,
            borderRadius: 6,
            border: 0,
            background: "var(--tc-dock-control-bg, transparent)",
            color: "rgba(255, 255, 255, 0.4)",
            cursor: "pointer",
            display: "none",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 100ms, color 100ms",
            flexShrink: 0,
          }}
        >
          <Settings width={14} height={14} stroke="currentColor" strokeWidth={2} aria-hidden="true" />
        </button>

        <div style={{ flex: "1 1 0%" }} />

        <div ref={quantityRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={quantityOpen}
            aria-label="生成数量"
            onClick={() => setQuantityOpen(!quantityOpen)}
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
              color: "rgba(255, 255, 255, 0.85)",
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
            <span style={{ fontSize: 12, lineHeight: "16px", fontWeight: 600 }}>{quantity}</span>
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ position: "relative", display: "inline-flex" }}>
            <button
              type="button"
              disabled={isEmpty || generating}
              onClick={() => {
                const isOmni = refMode.id === "omni";
                onGenerate?.({
                  model: selectedModel,
                  resolution,
                  aspectRatio,
                  duration,
                  quantity,
                  refMode,
                  // 互斥：首尾帧模式发 frame url，omni 模式发参考素材（火山三场景不可混用）
                  firstFrameUrl: isOmni ? undefined : firstFrameUrl,
                  lastFrameUrl: isOmni ? undefined : lastFrameUrl,
                  referenceImages: isOmni ? collectRefs("image") : undefined,
                  referenceVideos: isOmni ? collectRefs("video") : undefined,
                  referenceAudios: isOmni ? collectRefs("audio") : undefined,
                });
              }}
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
                background: isEmpty || generating ? "rgba(255, 255, 255, 0.06)" : "var(--tc-accent)",
                color: isEmpty || generating ? "rgba(255, 255, 255, 0.32)" : "rgb(255, 255, 255)",
                cursor: isEmpty || generating ? "default" : "pointer",
                opacity: 1,
              }}
            >
              <CreditIcon size={14} />
              <span style={{ fontSize: 12, fontWeight: 600, lineHeight: "16px" }}>15</span>
              <span style={{ lineHeight: "16px", marginLeft: 2, display: "inline-flex", alignItems: "center", gap: 4 }}>
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
              borderColor: "currentcolor currentcolor currentcolor rgba(255, 255, 255, 0.08)",
              borderImage: "initial",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "background 100ms, color 100ms",
              background: "rgba(255, 255, 255, 0.06)",
              color: "rgba(255, 255, 255, 0.32)",
              cursor: "default",
            }}
          >
            <ChevronUp width={16} height={16} strokeWidth={2.25} aria-hidden="true" />
          </button>
        </div>
      </div>

      {refModeOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={refModeMenuRef}
            data-tc-tab-dropdown-menu="true"
            style={{
              position: "fixed",
              left: refModePos.left,
              bottom: refModePos.bottom,
              minWidth: 168,
              height: "fit-content",
              background: "rgba(41, 41, 41, 0.92)",
              backdropFilter: "blur(40px)",
              border: "1px solid rgba(255, 255, 255, 0.04)",
              borderRadius: 8,
              padding: "8px 4px",
              zIndex: 2147483602,
              boxShadow: "rgba(0, 0, 0, 0.6) 0px 8px 24px",
              opacity: 1,
              transform: "scale(1) translateY(0px)",
              transformOrigin: "left bottom",
              transition:
                "opacity 250ms cubic-bezier(0.16, 1, 0.3, 1), transform 250ms cubic-bezier(0.16, 1, 0.3, 1)",
              display: "flex",
              flexDirection: "column",
              gap: 0,
            }}
          >
            {REF_MODES.map((m) => {
              const selected = refMode.id === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setRefMode(m);
                    setRefModeOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "8px 16px",
                    border: 0,
                    borderRadius: 4,
                    background: selected ? "rgba(255, 255, 255, 0.08)" : "transparent",
                    color: selected ? "rgb(255, 255, 255)" : "rgba(255, 255, 255, 0.7)",
                    fontSize: 12,
                    fontWeight: selected ? 600 : 500,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: selected
                      ? "background 180ms cubic-bezier(0.16, 1, 0.3, 1)"
                      : "background 100ms ease-in",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}

      {modelSettingsOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={modelSettingsMenuRef}
            data-tc-dock-popover=""
            style={{
              position: "fixed",
              left: modelSettingsPos.left,
              bottom: modelSettingsPos.bottom,
              width: "max-content",
              minWidth: 320,
              padding: "4px 8px",
              borderRadius: 8,
              background: "rgb(30, 30, 30)",
              border: "1px solid rgba(255, 255, 255, 0.04)",
              boxShadow: "rgba(0, 0, 0, 0.25) 0px 4px 16px",
              zIndex: 2147483602,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              opacity: 1,
              transform: "scale(1) translateY(0px)",
              transformOrigin: "left bottom",
              transition:
                "opacity 250ms cubic-bezier(0.16, 1, 0.3, 1), transform 250ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {/* 模型与质量 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0" }}>
              <div style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.45)", fontWeight: 500, padding: "0px 4px" }}>
                模型与质量
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                {/* 模型下拉 */}
                <div style={{ width: 224, flexShrink: 0, position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setModelDropdownOpen((v) => !v);
                      setResolutionDropdownOpen(false);
                    }}
                    style={{
                      height: 36,
                      padding: "0px 8px",
                      borderRadius: 8,
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      background: "rgba(255, 255, 255, 0.04)",
                      color: "rgb(255, 255, 255)",
                      fontSize: 12,
                      lineHeight: "16px",
                      fontWeight: 400,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      transition: "background 100ms",
                      whiteSpace: "nowrap",
                      maxWidth: "none",
                      width: 224,
                      justifyContent: "space-between",
                      boxSizing: "border-box",
                    }}
                  >
                    <span
                      style={{
                        color: "rgb(255, 255, 255)",
                        fontSize: 12,
                        lineHeight: "16px",
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {selectedModel.label}
                    </span>
                    <ChevronDown width={14} height={14} style={{ opacity: 0.6, marginLeft: "auto" }} />
                  </button>
                  {modelDropdownOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 6px)",
                        left: 0,
                        zIndex: 10,
                        background: "rgb(30, 30, 30)",
                        border: "1px solid rgba(255, 255, 255, 0.04)",
                        borderRadius: 8,
                        padding: 4,
                        boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
                        minWidth: 224,
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      {videoModels.map((m) => (
                        <button
                          key={m.modelId}
                          type="button"
                          onClick={() => {
                            onSelectModel(m);
                            setModelDropdownOpen(false);
                          }}
                          style={{
                            height: 32,
                            padding: "0px 8px",
                            borderRadius: 6,
                            border: 0,
                            background:
                              selectedModel.id === m.modelId ? "rgba(255, 255, 255, 0.08)" : "transparent",
                            color: "rgb(255, 255, 255)",
                            fontSize: 12,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            transition: "background 100ms",
                            whiteSpace: "nowrap",
                            textAlign: "left",
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>{m.modelLabel}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 分辨率下拉 */}
                <div
                  style={{
                    flex: "1 1 0%",
                    minWidth: 224,
                    position: "relative",
                    display: "block",
                    width: "100%",
                    boxSizing: "border-box",
                    verticalAlign: "middle",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setResolutionDropdownOpen((v) => !v);
                      setModelDropdownOpen(false);
                    }}
                    style={{
                      height: 36,
                      padding: "0px 8px",
                      borderRadius: 8,
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      background: "rgba(255, 255, 255, 0.04)",
                      color: "rgb(255, 255, 255)",
                      fontSize: 12,
                      lineHeight: "16px",
                      fontWeight: 400,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "background 100ms",
                      whiteSpace: "nowrap",
                      width: "100%",
                      boxSizing: "border-box",
                      justifyContent: "space-between",
                    }}
                  >
                    <span
                      style={{
                        color: "rgb(255, 255, 255)",
                        fontSize: 12,
                        lineHeight: "16px",
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: "1 1 0%",
                        textAlign: "left",
                      }}
                    >
                      {resolution.label}
                    </span>
                    <ChevronDown width={14} height={14} style={{ opacity: 0.6, marginLeft: "auto" }} />
                  </button>
                  {resolutionDropdownOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 6px)",
                        left: 0,
                        zIndex: 10,
                        background: "rgb(30, 30, 30)",
                        border: "1px solid rgba(255, 255, 255, 0.04)",
                        borderRadius: 8,
                        padding: 4,
                        boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
                        minWidth: 224,
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      {resolutions.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            setResolution({ id: r.id, label: r.label });
                            setResolutionDropdownOpen(false);
                          }}
                          style={{
                            height: 32,
                            padding: "0px 8px",
                            borderRadius: 6,
                            border: 0,
                            background:
                              resolution.id === r.id ? "rgba(255, 255, 255, 0.08)" : "transparent",
                            color: "rgb(255, 255, 255)",
                            fontSize: 12,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            transition: "background 100ms",
                            whiteSpace: "nowrap",
                            width: "100%",
                            boxSizing: "border-box",
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>{r.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 时长滑块 */}
            <div className="tc-duration-slider">
              <div className="tc-duration-slider__header">
                <span className="tc-duration-slider__label">时长</span>
                <span className="tc-duration-slider__value">{duration}s</span>
              </div>
              <input
                className="tc-duration-slider__input"
                min={drMin}
                max={drMax}
                step={drStep}
                aria-label="时长"
                aria-valuetext={`${duration}s`}
                type="range"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                style={{
                  ["--tc-duration-slider-progress" as string]: `${
                    ((duration - drMin) / (drMax - drMin)) * 100
                  }%`,
                }}
              />
              <div className="tc-duration-slider__ticks" aria-hidden="true">
                <div className="tc-duration-slider__tick-track">
                  {durationTicks.map((t) => (
                    <span
                      key={t}
                      className={`tc-duration-slider__tick${t === duration ? " tc-duration-slider__tick--active" : ""}`}
                      style={{
                        ["--tc-duration-slider-tick-position" as string]: `${
                          ((t - drMin) / (drMax - drMin)) * 100
                        }%`,
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className="tc-duration-slider__limits" aria-hidden="true">
                <span>{drMin}s</span>
                <span>{drMax}s</span>
              </div>
            </div>

            {/* 宽高比 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
              <div style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.45)", fontWeight: 500, padding: "0px 4px" }}>
                宽高比
              </div>
              <div
                style={{
                  display: "flex",
                  background: "rgba(255, 255, 255, 0.04)",
                  borderRadius: 8,
                  padding: 4,
                  gap: 2,
                }}
              >
                {VIDEO_ASPECT_RATIOS.map((r) => {
                  const selected = aspectRatio.id === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setAspectRatio(r)}
                      style={{
                        flex: "1 1 0%",
                        height: 44,
                        border: 0,
                        borderRadius: 6,
                        background: selected ? "rgba(255, 255, 255, 0.08)" : "transparent",
                        color: selected ? "rgb(255, 255, 255)" : "rgba(255, 255, 255, 0.45)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        cursor: "pointer",
                        transition: "150ms",
                        padding: 0,
                      }}
                    >
                      <span style={{ opacity: selected ? 1 : 0.6, flexShrink: 0 }}>
                        <AspectRatioIcon ratio={r.id} width={14} height={14} filled={false} />
                      </span>
                      <span style={{ fontSize: 11, fontWeight: selected ? 600 : 500, lineHeight: "12px" }}>
                        {r.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {quantityOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={quantityMenuRef}
            data-tc-dock-popover=""
            role="listbox"
            aria-label="选择生成数量"
            style={{
              position: "fixed",
              left: quantityPos.left,
              bottom: quantityPos.bottom,
              width: "max-content",
              minWidth: 120,
              padding: "4px 8px",
              borderRadius: 8,
              background: "rgb(30, 30, 30)",
              border: "1px solid rgba(255, 255, 255, 0.04)",
              boxShadow: "rgba(0, 0, 0, 0.25) 0px 4px 16px",
              zIndex: 2147483602,
              display: "flex",
              flexDirection: "column",
              gap: 0,
              boxSizing: "border-box",
              opacity: 1,
              transform: "scale(1) translateY(0px)",
              transformOrigin: "left bottom",
              transition:
                "opacity 250ms cubic-bezier(0.16, 1, 0.3, 1), transform 250ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {QUANTITIES.map((q) => {
              const selected = quantity === q;
              return (
                <button
                  key={q}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setQuantity(q);
                    setQuantityOpen(false);
                  }}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    border: 0,
                    borderRadius: 6,
                    background: selected ? "rgba(255, 255, 255, 0.08)" : "transparent",
                    color: selected ? "rgba(255, 255, 255, 0.85)" : "rgba(255, 255, 255, 0.45)",
                    fontSize: 12,
                    lineHeight: "16px",
                    fontWeight: selected ? 500 : 400,
                    cursor: "pointer",
                    textAlign: "left",
                    whiteSpace: "nowrap",
                    transition: "background 80ms",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {q}
                </button>
              );
            })}
          </div>,
          document.body,
        )}

      {openMediaCategory &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={mediaCategoryMenuRef}
            data-tc-dock-popover=""
            role="dialog"
            aria-label={`${MEDIA_CATEGORY_SPECS[openMediaCategory].label}素材`}
            style={{
              position: "fixed",
              left: mediaCategoryPos.left,
              bottom: mediaCategoryPos.bottom,
              width: "max-content",
              minWidth: 260,
              maxWidth: 320,
              padding: 12,
              borderRadius: 10,
              background: "rgb(30, 30, 30)",
              border: "1px solid rgba(255, 255, 255, 0.04)",
              boxShadow: "rgba(0, 0, 0, 0.25) 0px 4px 16px",
              zIndex: 2147483602,
              boxSizing: "border-box",
              opacity: 1,
              transform: "scale(1) translateY(0px)",
              transformOrigin: "left bottom",
              transition:
                "opacity 250ms cubic-bezier(0.16, 1, 0.3, 1), transform 250ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            <MediaSection
              spec={MEDIA_CATEGORY_SPECS[openMediaCategory].spec}
              accept={MEDIA_CATEGORY_SPECS[openMediaCategory].accept}
              items={media.filter((m) => m.type === openMediaCategory)}
              uploadedMax={MEDIA_CATEGORY_SPECS[openMediaCategory].uploadedMax}
              total={media.length}
              totalMax={15}
              onRemove={onRemoveMedia}
              onUpload={onLocalUpload}
              onPickFromCanvas={onPickFromCanvas}
            />
          </div>,
          document.body,
        )}

      <div
        style={{
          display: "grid",
          gridTemplateRows: advancedOpen ? "1fr" : "0fr",
          opacity: advancedOpen ? 1 : 0,
          overflow: "hidden",
          transition: "grid-template-rows 160ms ease-in, opacity 140ms ease-in",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <div
            style={{
              borderTop: "1px solid rgba(255, 255, 255, 0.07)",
              background: "rgb(29, 29, 29)",
              borderRadius: "0px 0px 12px 12px",
              padding: "4px 12px 8px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "7px 0px",
                gap: 12,
              }}
            >
              <span style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.65)", fontWeight: 400 }}>联网搜索</span>
              <button
                type="button"
                onClick={() => setInternetSearch(!internetSearch)}
                style={{
                  position: "relative",
                  width: 36,
                  height: 20,
                  borderRadius: 10,
                  border: 0,
                  background: internetSearch ? "rgba(255, 255, 255, 0.5)" : "rgba(255, 255, 255, 0.15)",
                  cursor: "pointer",
                  transition: "background 150ms",
                  flexShrink: 0,
                  padding: 0,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 2,
                    left: internetSearch ? 18 : 2,
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: "rgb(255, 255, 255)",
                    transition: "left 150ms, background 150ms",
                    boxShadow: "rgba(0, 0, 0, 0.3) 0px 1px 3px",
                  }}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
