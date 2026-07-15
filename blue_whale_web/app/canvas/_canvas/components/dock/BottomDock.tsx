/**
 * BottomDock —— 底部 Dock 容器（容器 + 状态提升层）
 * 持有图片/视频 Dock 的共享状态（模型/宽高比/分辨率/参考模式等），
 * 按 mode 切换渲染 ImageDockContent 或 VideoDockContent，并提供关闭与素材删除回调。
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { SmoothCorners } from "@/components/SmoothCorners";
import { squirclePath } from "../../utils";
import { VIDEO_MODELS, VIDEO_ASPECT_RATIOS, VIDEO_RESOLUTIONS, REF_MODES } from "../../constants";
import type { DockMediaItem, GenerateArgs } from "../../types";
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
}) {
  const [input, setInput] = useState("");
  const [dockSize, setDockSize] = useState({ w: 680, h: 164 });
  const editorRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [refMode, setRefMode] = useState(REF_MODES[0]);
  const [refModeOpen, setRefModeOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(VIDEO_MODELS[0]);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(VIDEO_ASPECT_RATIOS[0]);
  const [resolution, setResolution] = useState(VIDEO_RESOLUTIONS[1]);
  const [duration, setDuration] = useState(10);
  const [quantity, setQuantity] = useState("1x");
  const [quantityOpen, setQuantityOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [internetSearch, setInternetSearch] = useState(false);

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
                  setSelectedModel={setSelectedModel}
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
