/**
 * VideoDockContent —— AI 视频生成 Dock 表单（展示层，受控组件）
 * 承载视频提示词与模型/宽高比/分辨率/时长/数量/参考模式等完整配置。
 * 状态由 BottomDock 提升并以 props 受控传入，本组件仅负责渲染与回调。
 */
import { useEffect, useRef, useState } from "react";
import {
  getVideoModels,
  type ImageModelCapability,
} from "../../api/generation";
import {
  VIDEO_MODELS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_RESOLUTIONS,
  REF_MODES,
} from "../../constants";
import type { VideoDockContentProps } from "../../types";
import { isSeedance2Model, resolveDuration } from "./video-dock-lib";
import { VideoDockTopCard } from "./video-dock-top-card";
import {
  VideoModelSettingsPanel,
  VideoRefModeMenu,
  VideoQuantityMenu,
} from "./video-dock-flyouts";
import { UploadSourceMenu } from "./UploadSourceMenu";


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
      <VideoDockTopCard
        onClose={onClose}
        refMode={refMode}
        firstFrameUrl={firstFrameUrl}
        lastFrameUrl={lastFrameUrl}
        media={media}
        onRemoveMedia={onRemoveMedia}
        onPreviewMedia={onPreviewMedia}
        onSwapFrames={onSwapFrames}
        onFrameUpload={onFrameUpload}
        onFrameClear={onFrameClear}
        onPickFrameFromCanvas={onPickFrameFromCanvas}
        supportsReferenceVideo={supportsReferenceVideo}
        uploadMenuOpen={uploadMenuOpen}
        uploadKind={uploadKind}
        refModeOpen={refModeOpen}
        onOpenModelSettings={() => setModelSettingsOpen(true)}
        mediaAddRef={mediaAddRef}
        placeholderRef={placeholderRef}
        videoTriggerRef={videoTriggerRef}
        plusRef={plusRef}
        refModeRef={refModeRef}
        modelSettingsRef={modelSettingsRef}
        quantityRef={quantityRef}
        onTriggerClick={handleTriggerClick}
        editorRef={editorRef}
        isEmpty={isEmpty}
        onInput={onInput}
        selectedModel={selectedModel}
        resolution={resolution}
        aspectRatio={aspectRatio}
        duration={duration}
        quantity={quantity}
        quantityOpen={quantityOpen}
        onOpenRefMode={() => setRefModeOpen(true)}
        onToggleQuantity={() => setQuantityOpen(!quantityOpen)}
        onToggleAdvanced={() => setAdvancedOpen(!advancedOpen)}
        onGenerate={onGenerate}
        generating={generating}
      />

      {refModeOpen && (
        <VideoRefModeMenu
          pos={refModePos}
          menuRef={refModeMenuRef}
          refMode={refMode}
          refModeOptions={refModeOptions}
          onRefModeChange={setRefMode}
          onClose={() => setRefModeOpen(false)}
        />
      )}

      {modelSettingsOpen && (
        <VideoModelSettingsPanel
          pos={modelSettingsPos}
          menuRef={modelSettingsMenuRef}
          selectedModel={selectedModel}
          models={modelOptions}
          onModelChange={handleModelChange}
          resolution={resolution}
          resolutionOptions={resolutionOptions}
          onResolutionChange={setResolution}
          aspectRatio={aspectRatio}
          aspectRatioOptions={aspectRatioOptions}
          onAspectRatioChange={setAspectRatio}
          duration={duration}
          onDurationChange={setDuration}
          capability={selectedCapability}
        />
      )}

      {quantityOpen && (
        <VideoQuantityMenu
          pos={quantityPos}
          menuRef={quantityMenuRef}
          quantity={quantity}
          quantityMax={quantityMax}
          onQuantityChange={setQuantity}
          onClose={() => setQuantityOpen(false)}
        />
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
