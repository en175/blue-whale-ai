/**
 * VideoDockContent —— AI 视频生成 Dock 表单（展示层，受控组件）
 * 承载视频提示词与模型/宽高比/分辨率/时长/数量/参考模式等完整配置。
 * 状态由 BottomDock 提升并以 props 受控传入，本组件仅负责渲染与回调。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Settings,
  Settings2,
  Video,
} from "lucide-react";
import { AspectRatioIcon } from "@/components/icons/AspectRatioIcon";
import { CreditIcon, IconClose, IconPlus } from "../../icons";
import {
  getVideoModels,
  type ImageModelCapability,
} from "../../api/generation";
import {
  VIDEO_MODELS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_RESOLUTIONS,
  VIDEO_DURATION_MIN,
  VIDEO_DURATION_MAX,
  VIDEO_DURATION_STEP,
  REF_MODES,
  QUANTITIES,
} from "../../constants";
import type { VideoDockContentProps } from "../../types";
import { DockMediaThumb, FrameUploadButton } from "./parts";
import { UploadSourceMenu } from "./UploadSourceMenu";

/** 时长边界：优先用模型 supported_durations，缺省回落硬编码常量。 */
function durationBounds(cap: ImageModelCapability | undefined) {
  const d = cap?.supported_durations;
  return d
    ? { min: d.min, max: d.max, step: d.step }
    : {
        min: VIDEO_DURATION_MIN,
        max: VIDEO_DURATION_MAX,
        step: VIDEO_DURATION_STEP,
      };
}
function durationTicks(cap: ImageModelCapability | undefined) {
  const { min, max, step } = durationBounds(cap);
  const ticks: number[] = [];
  for (let v = min; v <= max; v += step) ticks.push(v);
  return ticks;
}
/** 切模型时把时长收进新区间：在区间内保留，否则回 default_duration（再不行回 min）。 */
function resolveDuration(
  cap: ImageModelCapability | undefined,
  current: number,
) {
  const { min, max } = durationBounds(cap);
  if (current >= min && current <= max) return current;
  const def = cap?.default_duration;
  if (def != null && def >= min && def <= max) return def;
  return min;
}

/** 是否 Seedance 2.0 系模型——只有它们支持参考视频（对齐 worker validateReferences
 *  的 isSeedance2Model，video-job-runner.ts）。TODO: 改用 capability reference_video 字段。 */
function isSeedance2Model(modelId: string | undefined): boolean {
  return (
    !!modelId &&
    (modelId === "seedance-2" || /^doubao-seedance-2-0(?:-|$)/.test(modelId))
  );
}

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
    setSelectedModel,
    modelSettingsOpen,
    setModelSettingsOpen,
    aspectRatio,
    setAspectRatio,
    resolution,
    setResolution,
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
    media = [],
    onRemoveMedia,
    onLocalUpload,
    onPickFromCanvas,
    onExitPick,
    isPicking = false,
    onGenerate,
    generating = false,
    onPreviewMedia,
    firstFrameUrl,
    lastFrameUrl,
    onFrameUpload,
    onFrameClear,
    onSwapFrames,
    onPickFrameFromCanvas,
    models: injectedModels,
    resolutions: injectedResolutions,
    aspectRatios: injectedAspectRatios,
    quantityMax: injectedQuantityMax,
  } = props;
  const [modelCapabilities, setModelCapabilities] = useState<
    ImageModelCapability[]
  >([]);
  const modelOptions =
    injectedModels ??
    (modelCapabilities.length > 0
      ? modelCapabilities.map((model) => ({
          id: model.model_id,
          label: model.model_label,
        }))
      : VIDEO_MODELS);
  const selectedCapability = modelCapabilities.find(
    (model) => model.model_id === selectedModel.id,
  );
  const resolutionOptions =
    injectedResolutions ??
    selectedCapability?.supported_sizes.map((size) => ({
      id: size.id,
      label: size.label,
    })) ??
    VIDEO_RESOLUTIONS;
  const aspectRatioOptions =
    injectedAspectRatios ??
    selectedCapability?.supported_aspect_ratios.map((ratio) => ({
      id: ratio,
      label: ratio,
    })) ??
    VIDEO_ASPECT_RATIOS;
  const quantityMax =
    injectedQuantityMax ?? selectedCapability?.features.quantity_max ?? 1;
  const {
    min: durMin,
    max: durMax,
    step: durStep,
  } = durationBounds(selectedCapability);
  const durTicks = durationTicks(selectedCapability);
  // 首尾帧 ref 模式仅在该模型支持 first_last_frame 时可选。
  const refModeOptions = REF_MODES.filter(
    (m) =>
      m.id !== "first-last" ||
      selectedCapability?.features.first_last_frame !== false,
  );
  // 参考视频：只有 Seedance 2.0 支持参考视频（镜像 worker isSeedance2Model，
  // video-job-runner.ts validateReferences）。TODO: 改用 capability reference_video 字段。
  const supportsReferenceVideo = isSeedance2Model(selectedModel?.id);

  useEffect(() => {
    if (injectedModels) return;
    let cancelled = false;
    getVideoModels()
      .then((models) => {
        if (cancelled || models.length === 0) return;
        setModelCapabilities(models);
        const capability =
          models.find((model) => model.model_id === selectedModel.id) ??
          models[0];
        const model = {
          id: capability.model_id,
          label: capability.model_label,
        };
        setSelectedModel(model);
        const supportedResolutions = capability.supported_sizes.map((size) => ({
          id: size.id,
          label: size.label,
        }));
        if (
          !supportedResolutions.some((option) => option.id === resolution.id)
        ) {
          setResolution(
            supportedResolutions.find(
              (option) => option.id === capability.default_size,
            ) ??
              supportedResolutions[0] ??
              resolution,
          );
        }
        const supportedRatios = capability.supported_aspect_ratios.map(
          (ratio) => ({ id: ratio, label: ratio }),
        );
        if (!supportedRatios.some((option) => option.id === aspectRatio.id)) {
          setAspectRatio(
            supportedRatios.find(
              (option) => option.id === capability.default_aspect_ratio,
            ) ??
              supportedRatios[0] ??
              aspectRatio,
          );
        }
        const currentQuantity = Number.parseInt(quantity, 10);
        if (
          Number.isFinite(currentQuantity) &&
          currentQuantity > capability.features.quantity_max
        ) {
          setQuantity(`${capability.features.quantity_max}x`);
        }
        setDuration(resolveDuration(capability, duration));
      })
      .catch((error) => {
        console.error("getVideoModels failed", error);
      });
    return () => {
      cancelled = true;
    };
    // Initial capability hydration follows ImageDockContent: subsequent changes
    // are handled explicitly by the model picker below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectedModels]);

  const handleModelChange = (model: { id: string; label: string }) => {
    setSelectedModel(model);
    const capability = modelCapabilities.find(
      (candidate) => candidate.model_id === model.id,
    );
    if (!capability) return;
    const supportedResolutions = capability.supported_sizes.map((size) => ({
      id: size.id,
      label: size.label,
    }));
    if (!supportedResolutions.some((option) => option.id === resolution.id)) {
      setResolution(
        supportedResolutions.find(
          (option) => option.id === capability.default_size,
        ) ??
          supportedResolutions[0] ??
          resolution,
      );
    }
    const supportedRatios = capability.supported_aspect_ratios.map((ratio) => ({
      id: ratio,
      label: ratio,
    }));
    if (!supportedRatios.some((option) => option.id === aspectRatio.id)) {
      setAspectRatio(
        supportedRatios.find(
          (option) => option.id === capability.default_aspect_ratio,
        ) ??
          supportedRatios[0] ??
          aspectRatio,
      );
    }
    const currentQuantity = Number.parseInt(quantity, 10);
    if (
      Number.isFinite(currentQuantity) &&
      currentQuantity > capability.features.quantity_max
    ) {
      setQuantity(`${capability.features.quantity_max}x`);
    }
    setDuration(resolveDuration(capability, duration));
    if (refMode.id === "first-last" && !capability.features.first_last_frame) {
      setRefMode(REF_MODES[0]);
    }
  };

  // 上传来源菜单（参考图占位 + 参考视频按钮 + 加号共用）。kind 决定「本地上传」打开哪个 file input。
  const localFileRef = useRef<HTMLInputElement>(null);
  const videoFileRef = useRef<HTMLInputElement>(null);
  const placeholderRef = useRef<HTMLButtonElement>(null);
  const videoTriggerRef = useRef<HTMLButtonElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  // 缩略图行「继续添加」按钮（media 非空时追加在缩略图后，IK 修复）
  const mediaAddRef = useRef<HTMLButtonElement>(null);
  const uploadTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [uploadKind, setUploadKind] = useState<"image" | "video">("image");

  const openUploadMenuFrom = (
    ref: React.RefObject<HTMLButtonElement | null>,
    kind: "image" | "video" = "image",
  ) => {
    uploadTriggerRef.current = ref.current;
    setUploadKind(kind);
    setUploadMenuOpen(true);
  };
  const handleTriggerClick = (
    ref: React.RefObject<HTMLButtonElement | null>,
    kind: "image" | "video" = "image",
  ) => {
    if (isPicking) {
      onExitPick?.();
      return;
    }
    openUploadMenuFrom(ref, kind);
  };
  const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      onLocalUpload?.(files[i]);
    }
    e.target.value = "";
  };

  const refModeRef = useRef<HTMLDivElement>(null);
  const refModeMenuRef = useRef<HTMLDivElement>(null);
  const modelSettingsRef = useRef<HTMLButtonElement>(null);
  const modelSettingsMenuRef = useRef<HTMLDivElement>(null);
  const quantityRef = useRef<HTMLDivElement>(null);
  const quantityMenuRef = useRef<HTMLDivElement>(null);

  const [refModePos, setRefModePos] = useState<{
    left: number;
    bottom: number;
  }>({ left: 0, bottom: 0 });
  const [modelSettingsPos, setModelSettingsPos] = useState<{
    left: number;
    bottom: number;
  }>({ left: 0, bottom: 0 });
  const [quantityPos, setQuantityPos] = useState<{
    left: number;
    bottom: number;
  }>({ left: 0, bottom: 0 });
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [resolutionDropdownOpen, setResolutionDropdownOpen] = useState(false);

  useEffect(() => {
    if (refModeOpen && refModeRef.current) {
      const rect = refModeRef.current.getBoundingClientRect();
      setRefModePos({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 8,
      });
    }
  }, [refModeOpen]);

  useEffect(() => {
    if (modelSettingsOpen && modelSettingsRef.current) {
      const rect = modelSettingsRef.current.getBoundingClientRect();
      setModelSettingsPos({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 8,
      });
    }
  }, [modelSettingsOpen]);

  useEffect(() => {
    if (quantityOpen && quantityRef.current) {
      const rect = quantityRef.current.getBoundingClientRect();
      setQuantityPos({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 8,
      });
    }
  }, [quantityOpen]);

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

  return (
    <>
      <input
        ref={localFileRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        aria-hidden="true"
        onChange={handleLocalFileChange}
      />
      <input
        ref={videoFileRef}
        type="file"
        accept=".mp4,.mov,video/mp4,video/quicktime"
        multiple
        className="sr-only"
        aria-hidden="true"
        onChange={handleLocalFileChange}
      />
      <UploadSourceMenu
        triggerRef={uploadTriggerRef}
        open={uploadMenuOpen}
        onClose={() => setUploadMenuOpen(false)}
        onLocalUpload={() =>
          (uploadKind === "video"
            ? videoFileRef
            : localFileRef
          ).current?.click()
        }
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
                      previewUrl={firstFrameUrl}
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
                      previewUrl={lastFrameUrl}
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
                          onClick={() => handleTriggerClick(mediaAddRef)}
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
                        onClick={() => handleTriggerClick(placeholderRef)}
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
                          handleTriggerClick(videoTriggerRef, "video")
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
            onClick={() => handleTriggerClick(plusRef)}
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
          onClick={() => setAdvancedOpen(!advancedOpen)}
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
              background: "var(--tc-dock-popover-bg)",
              backdropFilter: "blur(40px)",
              border: "1px solid var(--tc-menu-pill-border)",
              borderRadius: 8,
              padding: "8px 4px",
              zIndex: 2147483602,
              boxShadow: "var(--tc-dock-popover-shadow)",
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
            {refModeOptions.map((m) => {
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
                    background: selected
                      ? "var(--tc-menu-item-hover)"
                      : "transparent",
                    color: selected
                      ? "var(--tc-text-primary)"
                      : "var(--tc-text-secondary)",
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
              background: "var(--tc-dock-popup-bg)",
              border: "1px solid var(--tc-menu-pill-border)",
              boxShadow: "var(--tc-dock-popup-shadow)",
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
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: "4px 0",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: "var(--tc-dock-text-caption)",
                  fontWeight: 500,
                  padding: "0px 4px",
                }}
              >
                模型与质量
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                {/* 模型下拉 */}
                <div
                  style={{ width: 224, flexShrink: 0, position: "relative" }}
                >
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
                      border: "1px solid var(--tc-border-subtle)",
                      background: "var(--tc-dock-fill-faint)",
                      color: "var(--tc-text-primary)",
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
                        color: "var(--tc-text-primary)",
                        fontSize: 12,
                        lineHeight: "16px",
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {selectedModel.label}
                    </span>
                    <ChevronDown
                      width={14}
                      height={14}
                      style={{ opacity: 0.6, marginLeft: "auto" }}
                    />
                  </button>
                  {modelDropdownOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 6px)",
                        left: 0,
                        zIndex: 10,
                        background: "var(--tc-dock-popup-bg)",
                        border: "1px solid var(--tc-menu-pill-border)",
                        borderRadius: 8,
                        padding: 4,
                        boxShadow: "var(--tc-dock-popup-shadow)",
                        minWidth: 224,
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      {modelOptions.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            handleModelChange(m);
                            setModelDropdownOpen(false);
                          }}
                          style={{
                            height: 32,
                            padding: "0px 8px",
                            borderRadius: 6,
                            border: 0,
                            background:
                              selectedModel.id === m.id
                                ? "var(--tc-menu-item-hover)"
                                : "transparent",
                            color: "var(--tc-text-primary)",
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
                          <span style={{ fontWeight: 600 }}>{m.label}</span>
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
                      border: "1px solid var(--tc-border-subtle)",
                      background: "var(--tc-dock-fill-faint)",
                      color: "var(--tc-text-primary)",
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
                        color: "var(--tc-text-primary)",
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
                    <ChevronDown
                      width={14}
                      height={14}
                      style={{ opacity: 0.6, marginLeft: "auto" }}
                    />
                  </button>
                  {resolutionDropdownOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 6px)",
                        left: 0,
                        zIndex: 10,
                        background: "var(--tc-dock-popup-bg)",
                        border: "1px solid var(--tc-menu-pill-border)",
                        borderRadius: 8,
                        padding: 4,
                        boxShadow: "var(--tc-dock-popup-shadow)",
                        minWidth: 224,
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      {resolutionOptions.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            setResolution(r);
                            setResolutionDropdownOpen(false);
                          }}
                          style={{
                            height: 32,
                            padding: "0px 8px",
                            borderRadius: 6,
                            border: 0,
                            background:
                              resolution.id === r.id
                                ? "var(--tc-menu-item-hover)"
                                : "transparent",
                            color: "var(--tc-text-primary)",
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
                min={durMin}
                max={durMax}
                step={durStep}
                aria-label="时长"
                aria-valuetext={`${duration}s`}
                type="range"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                style={{
                  ["--tc-duration-slider-progress" as string]: `${
                    ((duration - durMin) / (durMax - durMin)) * 100
                  }%`,
                }}
              />
              <div className="tc-duration-slider__ticks" aria-hidden="true">
                <div className="tc-duration-slider__tick-track">
                  {durTicks.map((t) => (
                    <span
                      key={t}
                      className={`tc-duration-slider__tick${t === duration ? " tc-duration-slider__tick--active" : ""}`}
                      style={{
                        ["--tc-duration-slider-tick-position" as string]: `${
                          ((t - durMin) / (durMax - durMin)) * 100
                        }%`,
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className="tc-duration-slider__limits" aria-hidden="true">
                <span>{durMin}s</span>
                <span>{durMax}s</span>
              </div>
            </div>

            {/* 宽高比 */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "4px 0",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: "var(--tc-dock-text-caption)",
                  fontWeight: 500,
                  padding: "0px 4px",
                }}
              >
                宽高比
              </div>
              <div
                style={{
                  display: "flex",
                  background: "var(--tc-dock-fill-faint)",
                  borderRadius: 8,
                  padding: 4,
                  gap: 2,
                }}
              >
                {aspectRatioOptions.map((r) => {
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
                        background: selected
                          ? "var(--tc-menu-item-hover)"
                          : "transparent",
                        color: selected
                          ? "var(--tc-text-primary)"
                          : "var(--tc-dock-text-caption)",
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
                      <span
                        style={{ opacity: selected ? 1 : 0.6, flexShrink: 0 }}
                      >
                        <AspectRatioIcon
                          ratio={r.id}
                          width={14}
                          height={14}
                          filled={false}
                        />
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: selected ? 600 : 500,
                          lineHeight: "12px",
                        }}
                      >
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
              background: "var(--tc-dock-popup-bg)",
              border: "1px solid var(--tc-menu-pill-border)",
              boxShadow: "var(--tc-dock-popup-shadow)",
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
            {QUANTITIES.filter(
              (q) => Number.parseInt(q, 10) <= quantityMax,
            ).map((q) => {
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
                    background: selected
                      ? "var(--tc-menu-item-hover)"
                      : "transparent",
                    color: selected
                      ? "var(--tc-dock-text-strong)"
                      : "var(--tc-dock-text-caption)",
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
              borderTop: "1px solid var(--tc-dock-divider)",
              background: "var(--tc-dock-panel-bg)",
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
              <span
                style={{
                  fontSize: 12,
                  color: "var(--tc-dock-text-label)",
                  fontWeight: 400,
                }}
              >
                联网搜索
              </span>
              <button
                type="button"
                onClick={() => setInternetSearch(!internetSearch)}
                style={{
                  position: "relative",
                  width: 36,
                  height: 20,
                  borderRadius: 10,
                  border: 0,
                  background: internetSearch
                    ? "var(--tc-dock-toggle-on)"
                    : "var(--tc-dock-toggle-off)",
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
                    background: "var(--tc-text-primary)",
                    transition: "left 150ms, background 150ms",
                    boxShadow: "var(--tc-dock-knob-shadow)",
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
