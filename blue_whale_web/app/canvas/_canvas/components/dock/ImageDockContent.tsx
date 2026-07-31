/**
 * ImageDockContent —— AI 图片生成 Dock 表单（展示 + 局部状态层）
 * 承载提示词输入、模型/分辨率/宽高比设置、素材带入与数量选择；
 * 通过 createPortal 渲染模型设置浮层，提交经 onInput 回调上抛。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronUp,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
  Plus,
  Settings2,
  X,
} from "lucide-react";
import {
  ImageModelSettingsPopover,
  IMAGE_ASPECT_RATIOS,
  type ImageAspectRatio,
} from "@/components/ImageModelSettingsPopover";
import {
  getImageModels,
  type ImageModelCapability,
} from "../../api/generation";
import { CreditIcon } from "../../icons";
import { DEFAULT_MAX_REFERENCE_IMAGES, QUANTITIES } from "../../constants";
import type { ImageDockContentProps } from "../../types";
import { DockMediaThumb } from "./parts";
import { UploadSourceMenu } from "./UploadSourceMenu";

/** 放大/收起切换按钮（IK5OWV，方案 B）：hover 高亮 + 轻微上浮投影。 */
function ExpandToggleButton({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      aria-label={expanded ? "收起面板" : "放大面板"}
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 24,
        height: 24,
        borderRadius: 6,
        border: 0,
        background: hovered ? "var(--tc-dock-control-hover-bg)" : "transparent",
        color: hovered
          ? "var(--tc-dock-text-strong)"
          : "var(--tc-dock-text-faint)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        transform: hovered ? "translateY(-1px) scale(1.08)" : "none",
        boxShadow: hovered ? "0 2px 8px rgba(0, 0, 0, 0.3)" : "none",
        transition: "all 120ms ease",
      }}
    >
      {expanded ? (
        <Minimize2 width={13} height={13} />
      ) : (
        <Maximize2 width={13} height={13} />
      )}
    </button>
  );
}

export function ImageDockContent({
  editorRef,
  isEmpty,
  onInput,
  onClose,
  media = [],
  onRemoveMedia,
  onLocalUpload,
  onPickFromCanvas,
  onExitPick,
  isPicking = false,
  onGenerate,
  generating = false,
  onPreviewMedia,
  referenceCount = 0,
  onMaxReferenceImagesChange,
  expanded = false,
  onToggleExpand,
}: ImageDockContentProps) {
  const settingsRef = useRef<HTMLButtonElement>(null);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [models, setModels] = useState<ImageModelCapability[]>([]);
  const [selectedModel, setSelectedModel] =
    useState<ImageModelCapability | null>(null);
  const [selectedSize, setSelectedSize] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [selectedAspectRatio, setSelectedAspectRatio] =
    useState<ImageAspectRatio>(IMAGE_ASPECT_RATIOS[2]);
  const [webSearch, setWebSearch] = useState(false);
  const [sequential, setSequential] = useState(false);
  // 参考图入口按模型能力显隐：不支持参考图的模型（如 Seedream 5.0 Pro）不显示上传入口。
  const canReferenceImage = selectedModel?.features.reference_image ?? false;
  const maxReferenceImages =
    selectedModel?.features.max_reference_images ??
    DEFAULT_MAX_REFERENCE_IMAGES;
  const atReferenceLimit =
    canReferenceImage && referenceCount >= maxReferenceImages;

  useEffect(() => {
    onMaxReferenceImagesChange?.(maxReferenceImages);
  }, [maxReferenceImages, onMaxReferenceImagesChange]);

  // 取模型默认分辨率档位（能力表 default_size，缺省回退首个）。
  const pickDefaultSize = (m: ImageModelCapability) =>
    m.supported_sizes.find((s) => s.id === m.default_size) ??
    m.supported_sizes[0];

  // 模型列表改接口拉取（废除前端写死常量）。
  useEffect(() => {
    let cancelled = false;
    getImageModels()
      .then((list) => {
        if (cancelled || list.length === 0) return;
        const first = list[0];
        setModels(list);
        setSelectedModel(first);
        setSelectedSize(pickDefaultSize(first));
      })
      .catch((err) => {
        // 能力表拉取失败：保持空，无可用模型时生成按钮禁用。
        console.error("getImageModels failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 切模型联动：新模型不支持当前分辨率则重置到该模型默认。
  const handleModelChange = (model: ImageModelCapability) => {
    setSelectedModel(model);
    if (!model.supported_sizes.some((s) => s.id === selectedSize?.id)) {
      setSelectedSize(pickDefaultSize(model));
    }
    // 数量不超新模型上限（features.quantity_max）。
    const currentQty = parseInt(quantity, 10);
    if (!Number.isNaN(currentQty) && currentQty > model.features.quantity_max) {
      setQuantity(`${model.features.quantity_max}x`);
    }
    if (!model.features.tools) setWebSearch(false);
    if (!model.features.sequential_image_generation) setSequential(false);
  };

  // 上传来源菜单（占位按钮 + 加号共用）
  const localFileRef = useRef<HTMLInputElement>(null);
  const placeholderRef = useRef<HTMLButtonElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const uploadTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);

  const openUploadMenuFrom = (
    ref: React.RefObject<HTMLButtonElement | null>,
  ) => {
    uploadTriggerRef.current = ref.current;
    setUploadMenuOpen(true);
  };

  const handleTriggerClick = (
    ref: React.RefObject<HTMLButtonElement | null>,
  ) => {
    if (atReferenceLimit) return;
    if (isPicking) {
      onExitPick?.();
      return;
    }
    openUploadMenuFrom(ref);
  };

  const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      onLocalUpload?.(files[i]);
    }
    e.target.value = "";
  };

  const quantityRef = useRef<HTMLButtonElement>(null);
  const quantityMenuRef = useRef<HTMLDivElement>(null);
  const [quantityOpen, setQuantityOpen] = useState(false);
  const [quantity, setQuantity] = useState("1x");
  const [quantityPos, setQuantityPos] = useState<{
    left: number;
    bottom: number;
  }>({ left: 0, bottom: 0 });

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
    if (!quantityOpen) return;
    const handle = (e: MouseEvent) => {
      const t = e.target as Node;
      if (quantityRef.current?.contains(t)) return;
      if (quantityMenuRef.current?.contains(t)) return;
      setQuantityOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [quantityOpen]);

  // 放大态让输入区填满面板高度：逐层向下传递 flex（IK5OWV）。
  // fillColumn 把普通块级 div 变成可拉伸的 flex 列；fillFlex 给已是 flex 的 div 补 flex:1。
  const fillColumn: React.CSSProperties = expanded
    ? { flex: "1 1 0%", minHeight: 0, display: "flex", flexDirection: "column" }
    : {};
  const fillFlex: React.CSSProperties = expanded
    ? { flex: "1 1 0%", minHeight: 0 }
    : {};

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
        <div style={fillColumn}>
          <div style={fillColumn}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                width: "100%",
                ...fillFlex,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  borderRadius: 10,
                  position: "relative",
                  ...fillFlex,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    zIndex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                  }}
                >
                  <ExpandToggleButton
                    expanded={expanded}
                    onToggle={onToggleExpand}
                  />
                  {!expanded && (
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
                      <X width={13} height={13} />
                    </button>
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                    gap: 6,
                    paddingLeft: 4,
                  }}
                >
                  {media.length > 0 ? (
                    media.map((m) => (
                      <DockMediaThumb
                        key={m.id}
                        item={m}
                        onRemove={onRemoveMedia}
                      />
                    ))
                  ) : canReferenceImage ? (
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      <button
                        ref={placeholderRef}
                        type="button"
                        aria-label="Upload reference image"
                        aria-haspopup="menu"
                        aria-expanded={uploadMenuOpen}
                        disabled={atReferenceLimit}
                        title={
                          atReferenceLimit
                            ? `最多添加 ${maxReferenceImages} 张参考图`
                            : undefined
                        }
                        onClick={() => handleTriggerClick(placeholderRef)}
                        style={{
                          position: "relative",
                          width: 44,
                          height: 44,
                          padding: 0,
                          borderRadius: 9,
                          border: "1px solid rgba(255, 255, 255, 0.02)",
                          background: "rgba(255, 255, 255, 0.043)",
                          color: "rgba(255, 255, 255, 0.62)",
                          cursor: atReferenceLimit ? "default" : "pointer",
                          opacity: atReferenceLimit ? 0.4 : 1,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          overflow: "hidden",
                          transition: "background 120ms, color 120ms",
                          flexShrink: 0,
                        }}
                      >
                        <ImageIcon
                          width={18}
                          height={18}
                          stroke="currentColor"
                          strokeWidth={1.8}
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                  ) : null}
                </div>

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
                      // 放大态填满可用高度，收起态按内容自适应（上限 452）。
                      height: expanded ? "100%" : undefined,
                      maxHeight: expanded ? "none" : 452,
                      overflowY: "auto",
                      padding: "6px 8px",
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
                        left: 8,
                        top: 6,
                        color: "rgba(255, 255, 255, 0.3)",
                        fontSize: 14,
                        lineHeight: "22px",
                        pointerEvents: "none",
                      }}
                    >
                      描述你希望如何编辑这张图片...
                    </div>
                  )}
                </div>
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
        {canReferenceImage && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button
              ref={plusRef}
              type="button"
              aria-label="上传图片"
              aria-haspopup="menu"
              aria-expanded={uploadMenuOpen}
              disabled={atReferenceLimit}
              title={
                atReferenceLimit
                  ? `最多添加 ${maxReferenceImages} 张参考图`
                  : undefined
              }
              onClick={() => handleTriggerClick(plusRef)}
              style={{
                width: 24,
                height: 24,
                padding: 0,
                border: 0,
                borderRadius: "50%",
                background: "rgba(255, 255, 255, 0.07)",
                color: "rgba(255, 255, 255, 0.72)",
                cursor: atReferenceLimit ? "default" : "pointer",
                opacity: atReferenceLimit ? 0.4 : 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "background 120ms, color 120ms",
              }}
            >
              <Plus width={14} height={14} />
            </button>
          </div>
        )}

        <button
          ref={settingsRef}
          type="button"
          onClick={() => setModelSettingsOpen((v) => !v)}
          aria-label="图像模型设置"
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
              {selectedModel?.model_label ?? "加载中…"}
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
            {selectedAspectRatio.label}
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
            {selectedSize?.label ?? "—"}
          </div>
        </button>

        {selectedModel && selectedSize && (
          <ImageModelSettingsPopover
            triggerRef={settingsRef}
            open={modelSettingsOpen}
            onClose={() => setModelSettingsOpen(false)}
            models={models}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            selectedSize={selectedSize}
            onSizeChange={setSelectedSize}
            selectedAspectRatio={selectedAspectRatio}
            onAspectRatioChange={setSelectedAspectRatio}
            webSearch={webSearch}
            onWebSearchChange={setWebSearch}
            showWebSearch={selectedModel.features.tools}
            sequential={sequential}
            onSequentialChange={setSequential}
            showSequential={selectedModel.features.sequential_image_generation}
          />
        )}

        <div style={{ flex: "1 1 0%" }} />

        <button
          ref={quantityRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={quantityOpen}
          aria-label="生成数量"
          onClick={() => setQuantityOpen((v) => !v)}
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
          <span style={{ fontSize: 12, lineHeight: "16px", fontWeight: 600 }}>
            {quantity}
          </span>
        </button>

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
              {QUANTITIES.filter(
                (q) =>
                  parseInt(q, 10) <=
                  (selectedModel?.features.quantity_max ?? 1),
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
                        ? "rgba(255, 255, 255, 0.08)"
                        : "transparent",
                      color: selected
                        ? "rgba(255, 255, 255, 0.85)"
                        : "rgba(255, 255, 255, 0.45)",
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

        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ position: "relative", display: "inline-flex" }}>
            <button
              type="button"
              disabled={
                isEmpty || generating || !selectedModel || !selectedSize
              }
              onClick={() => {
                if (!selectedModel || !selectedSize) return;
                onGenerate?.({
                  modelId: selectedModel.model_id,
                  size: selectedSize.id,
                  webSearch: webSearch,
                  sequential: sequential,
                  referenceImageSupported:
                    selectedModel.features.reference_image,
                  aspectRatio: selectedAspectRatio,
                  quantity,
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
                background:
                  isEmpty || generating
                    ? "rgba(255, 255, 255, 0.06)"
                    : "var(--tc-accent)",
                color:
                  isEmpty || generating
                    ? "rgba(255, 255, 255, 0.32)"
                    : "rgb(255, 255, 255)",
                cursor: isEmpty || generating ? "default" : "pointer",
                opacity: 1,
              }}
            >
              <CreditIcon size={14} />
              <span
                style={{ fontSize: 12, fontWeight: 600, lineHeight: "16px" }}
              >
                0.2
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
                "currentcolor currentcolor currentcolor rgba(255, 255, 255, 0.08)",
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
