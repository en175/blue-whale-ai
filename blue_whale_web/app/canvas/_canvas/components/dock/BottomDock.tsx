/**
 * BottomDock —— 底部 Dock 容器（容器 + 状态提升层）
 * 持有图片/视频 Dock 的共享状态（模型/宽高比/分辨率/参考模式等），
 * 按 mode 切换渲染 ImageDockContent 或 VideoDockContent，并提供关闭与素材删除回调。
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { SmoothCorners } from "@/components/SmoothCorners";
import { squirclePath } from "../../utils";
import { REF_MODES } from "../../constants";
import { getVideoModels } from "../../api/generation";
import type { VideoModelCapability } from "../../api/generation";
import type { DockMediaItem, GenerateArgs, SelectOption } from "../../types";
import { ImageDockContent } from "./ImageDockContent";
import { VideoDockContent } from "./VideoDockContent";

export function BottomDock({
  mode,
  onClose,
  imageMedia = [],
  videoMedia = [],
  onRemoveImageMedia,
  onRemoveVideoMedia,
  onLocalUpload,
  onPickFromCanvas,
  onExitPick,
  isPicking = false,
  onGenerate,
  generating = false,
  generateError,
  onClearGenerateError,
  firstFrameUrl,
  lastFrameUrl,
  onFrameUpload,
  onFrameClear,
  onSwapFrames,
  focusSignal,
}: {
  mode: "image" | "video";
  onClose: () => void;
  imageMedia?: DockMediaItem[];
  videoMedia?: DockMediaItem[];
  onRemoveImageMedia?: (id: string) => void;
  onRemoveVideoMedia?: (id: string) => void;
  /** 本地上传（建画布节点 + 入对应 Dock media） */
  onLocalUpload?: (file: File) => void;
  /** 进入画布选择模式 */
  onPickFromCanvas?: () => void;
  /** 退出画布选择模式 */
  onExitPick?: () => void;
  /** 当前 Dock 是否处于选择模式 */
  isPicking?: boolean;
  /** 生成：prompt 由本组件 input state 取，settings 由各 Dock Content 拼 */
  onGenerate?: (prompt: string, args: GenerateArgs) => void;
  /** 生成进行中（禁用按钮防重复提交） */
  generating?: boolean;
  /** 生成错误提示（用户友好，非内部错误） */
  generateError?: string | null;
  /** 关闭生成错误提示 */
  onClearGenerateError?: () => void;
  /** 首尾帧（视频首尾帧模式，page 层上传后回填 TOS url）。 */
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  onFrameUpload?: (file: File, slot: "first" | "last") => void;
  onFrameClear?: (slot: "first" | "last") => void;
  onSwapFrames?: () => void;
  /** 重新编辑触发：递增 nonce → useEffect 聚焦 contentEditable + 闪烁（X4） */
  focusSignal?: number;
}) {
  const [input, setInput] = useState("");
  const [dockSize, setDockSize] = useState({ w: 680, h: 164 });
  const editorRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [refMode, setRefMode] = useState(REF_MODES[0]);
  const [refModeOpen, setRefModeOpen] = useState(false);
  const [videoModels, setVideoModels] = useState<VideoModelCapability[]>([]);
  const [selectedModel, setSelectedModel] = useState<SelectOption>({ id: "", label: "" });
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<SelectOption>({ id: "", label: "" });
  const [resolution, setResolution] = useState<SelectOption>({ id: "", label: "" });
  const [duration, setDuration] = useState(5);
  const [quantity, setQuantity] = useState("1x");
  const [quantityOpen, setQuantityOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [internetSearch, setInternetSearch] = useState(false);

  /** 应用某个视频模型：联动重置 分辨率/比例/时长 到该模型默认值（DB 驱动）。 */
  const applyModel = (cap: VideoModelCapability) => {
    const defRes = cap.supportedResolutions.find((r) => r.id === cap.defaultResolution) ?? cap.supportedResolutions[0];
    const defRatio = cap.supportedAspectRatios.includes(cap.defaultAspectRatio)
      ? cap.defaultAspectRatio
      : cap.supportedAspectRatios[0];
    setSelectedModel({ id: cap.modelId, label: cap.modelLabel });
    setResolution(defRes ? { id: defRes.id, label: defRes.label } : { id: "", label: "" });
    setAspectRatio({ id: defRatio, label: defRatio });
    setDuration(cap.defaultDuration ?? cap.durationRange?.min ?? 5);
  };

  useEffect(() => {
    let cancelled = false;
    getVideoModels()
      .then((ms) => {
        if (cancelled || ms.length === 0) return;
        setVideoModels(ms);
        applyModel(ms[0]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      setDockSize({ w: 680, h: Math.round(cr.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 重新编辑（X4）：focusSignal 变化 → 聚焦输入框 + pulse 闪烁动画
  useEffect(() => {
    if (!focusSignal) return;
    const raf = requestAnimationFrame(() => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      el.classList.remove("tc-dock-pulse");
      void el.offsetWidth; // 触发 reflow 重置动画，允许连续触发
      el.classList.add("tc-dock-pulse");
      const done = () => el.classList.remove("tc-dock-pulse");
      el.addEventListener("animationend", done, { once: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [focusSignal]);

  const path = squirclePath(dockSize.w, dockSize.h, 28.8);
  const isEmpty = input.trim().length === 0;

  const handleInput = () => {
    const text = editorRef.current?.innerText ?? "";
    setInput(text);
  };

  return (
    <div
      data-canvas-reference-drop-target={mode === "image" ? "image-dock" : "video-dock"}
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2147483601,
        width: 680,
      }}
    >
      <div
        style={{
          clipPath: "inset(0%)",
          opacity: 1,
          transition: "clip-path 120ms cubic-bezier(0.16, 1, 0.3, 1), opacity 120ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div style={{ position: "relative" }}>
          <SmoothCorners
            width={dockSize.w}
            height={dockSize.h}
            path={path}
            overlay={false}
            stroke={{ color: "#ffffff", width: 2, opacity: 0.04 }}
            style={{
              background: "rgba(41, 41, 41, 0.92)",
              backdropFilter: "blur(40px)",
              border: 0,
              display: "flex",
              flexDirection: "column",
              fontFamily: "Inter, -apple-system, sans-serif",
            }}
          >
            <div
              ref={contentRef}
              className="nodrag nopan nowheel"
              style={{ width: 680, background: "transparent", display: "flex", flexDirection: "column" }}
            >
              {generateError && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "8px 12px",
                    background: "rgba(239, 68, 68, 0.12)",
                    borderBottom: "1px solid rgba(239, 68, 68, 0.16)",
                    color: "rgb(248, 113, 113)",
                    fontSize: 12,
                    lineHeight: "16px",
                  }}
                >
                  <span>{generateError}</span>
                  <button
                    type="button"
                    aria-label="关闭错误提示"
                    onClick={onClearGenerateError}
                    style={{
                      width: 18,
                      height: 18,
                      padding: 0,
                      border: 0,
                      borderRadius: 4,
                      background: "transparent",
                      color: "inherit",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <X width={14} height={14} />
                  </button>
                </div>
              )}
              {mode === "image" ? (
                <ImageDockContent
                  editorRef={editorRef}
                  isEmpty={isEmpty}
                  onInput={handleInput}
                  onClose={onClose}
                  media={imageMedia}
                  onRemoveMedia={onRemoveImageMedia}
                  onLocalUpload={onLocalUpload}
                  onPickFromCanvas={onPickFromCanvas}
                  onExitPick={onExitPick}
                  isPicking={isPicking}
                  onGenerate={(s) => onGenerate?.(input, { mode: "image", settings: s })}
                  generating={generating}
                />
              ) : (
                <VideoDockContent
                  editorRef={editorRef}
                  isEmpty={isEmpty}
                  onInput={handleInput}
                  onClose={onClose}
                  refMode={refMode}
                  setRefMode={setRefMode}
                  refModeOpen={refModeOpen}
                  setRefModeOpen={setRefModeOpen}
                  selectedModel={selectedModel}
                  onSelectModel={applyModel}
                  videoModels={videoModels}
                  modelSettingsOpen={modelSettingsOpen}
                  setModelSettingsOpen={setModelSettingsOpen}
                  aspectRatio={aspectRatio}
                  setAspectRatio={setAspectRatio}
                  resolution={resolution}
                  setResolution={setResolution}
                  duration={duration}
                  setDuration={setDuration}
                  quantity={quantity}
                  setQuantity={setQuantity}
                  quantityOpen={quantityOpen}
                  setQuantityOpen={setQuantityOpen}
                  advancedOpen={advancedOpen}
                  setAdvancedOpen={setAdvancedOpen}
                  internetSearch={internetSearch}
                  setInternetSearch={setInternetSearch}
                  firstFrameUrl={firstFrameUrl}
                  lastFrameUrl={lastFrameUrl}
                  onFrameUpload={onFrameUpload}
                  onFrameClear={onFrameClear}
                  onSwapFrames={onSwapFrames}
                  media={videoMedia}
                  onRemoveMedia={onRemoveVideoMedia}
                  onLocalUpload={onLocalUpload}
                  onPickFromCanvas={onPickFromCanvas}
                  onExitPick={onExitPick}
                  isPicking={isPicking}
                  onGenerate={(s) => onGenerate?.(input, { mode: "video", settings: s })}
                  generating={generating}
                />
              )}
            </div>
          </SmoothCorners>
        </div>
      </div>
    </div>
  );
}
