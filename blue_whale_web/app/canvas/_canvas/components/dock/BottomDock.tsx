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
import type { DockMediaItem, GenerateArgs, PrefillSignal, SelectOption } from "../../types";
import { ImageDockContent } from "./ImageDockContent";
import { VideoDockContent } from "./VideoDockContent";
import { extractEditor, insertMention, removeMention, type MentionItem } from "./mention";
import { MediaPreviewModal } from "@/components/MediaPreviewModal";

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
  dockMentionSignal,
  prefillSignal,
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
  /** 重新编辑/带图生成触发：递增 nonce → 聚焦 contentEditable，显示原生 caret（X4） */
  focusSignal?: number;
  /** 插入参考图 mention：nonce 递增触发 effect，item 为待插参考图（X3 mention pill）。replace=true 清空 editor 只留一个 */
  dockMentionSignal?: { nonce: number; item: MentionItem | null; replace?: boolean };
  /** 重新编辑预填（P2）：nonce 递增 → 应用 recipe 参数到 Dock（prompt + video 设置；image 透传 ImageDockContent） */
  prefillSignal?: PrefillSignal;
}) {
  const [input, setInput] = useState("");
  /** 从 editor pill 抽取的参考图 URL（提交 referenceImages），随 handleInput 更新 */
  const [mentions, setMentions] = useState<string[]>([]);
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
  const [previewItem, setPreviewItem] = useState<DockMediaItem | null>(null);

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

  // 重新编辑/带图生成（X4）：focusSignal 变化 → 聚焦输入框，只显示浏览器原生 caret
  useEffect(() => {
    if (!focusSignal) return;
    const raf = requestAnimationFrame(() => editorRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [focusSignal]);

  // 插入参考图 mention pill（X3）：dockMentionSignal.nonce 变化 → editor 光标处插 pill
  useEffect(() => {
    const sig = dockMentionSignal;
    const item = sig?.item;
    if (!sig?.nonce || !item) return;
    const raf = requestAnimationFrame(() => {
      const el = editorRef.current;
      if (!el) return;
      insertMention(el, item, { replace: sig.replace });
    });
    return () => cancelAnimationFrame(raf);
  }, [dockMentionSignal]);

  // 重新编辑预填（P2）：prefillSignal.nonce → prompt+参考图命令式写进 contentEditable（非受控）+ video 设置
  useEffect(() => {
    if (!prefillSignal?.prefill) return;
    const p = prefillSignal.prefill;
    const el = editorRef.current;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (el) {
      el.innerHTML = "";
      el.focus();
      if (p.prompt) document.execCommand("insertText", false, p.prompt);
      // 参考图 pill 只插 image 模式（image 生成用 editor mentions）；video 走 videoDockMedia（page 按 ref.kind 设，分到 referenceImages/Videos/Audios）
      if (mode === "image") {
        p.references?.forEach((r) => insertMention(el, { id: `prefill-${r.url}`, type: r.kind, name: "", src: r.url }));
      }
      const { prompt: pp, referenceImages } = extractEditor(el);
      setInput(pp);
      setMentions(referenceImages);
    }
    if (mode === "video") {
      if (p.modelId) {
        const vm = videoModels.find((v) => v.modelId === p.modelId);
        setSelectedModel({ id: p.modelId, label: vm?.modelLabel ?? p.modelId });
      }
      if (p.aspectRatio) setAspectRatio({ id: p.aspectRatio, label: p.aspectRatio });
      if (p.resolution) {
        const vm = videoModels.find((v) => v.modelId === p.modelId);
        const res = vm?.supportedResolutions.find((r) => r.id === p.resolution);
        setResolution({ id: p.resolution, label: res?.label ?? p.resolution });
      }
      if (p.refMode) {
        const rm = REF_MODES.find((r) => r.id === p.refMode);
        if (rm) setRefMode(rm);
      }
      if (typeof p.duration === "number") setDuration(p.duration);
      if (p.quantity != null) setQuantity(`${p.quantity}x`);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [prefillSignal?.nonce, videoModels, mode]);

  const path = squirclePath(dockSize.w, dockSize.h, 28.8);
  const isEmpty = input.trim().length === 0 && mentions.length === 0;

  const handleInput = () => {
    const el = editorRef.current;
    if (!el) return;
    const { prompt, referenceImages } = extractEditor(el);
    setInput(prompt);
    setMentions(referenceImages);
  };

  const handleRemoveImageMedia = (id: string) => {
    const el = editorRef.current;
    if (el) removeMention(el, id);
    onRemoveImageMedia?.(id);
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
                  onRemoveMedia={handleRemoveImageMedia}
                  onLocalUpload={onLocalUpload}
                  onPickFromCanvas={onPickFromCanvas}
                  onExitPick={onExitPick}
                  isPicking={isPicking}
                  onGenerate={(s) => onGenerate?.(input, { mode: "image", settings: s, referenceImages: mentions })}
                  generating={generating}
                  onPreviewMedia={setPreviewItem}
                  prefillSignal={prefillSignal}
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
                  onPreviewMedia={setPreviewItem}
                />
              )}
            </div>
          </SmoothCorners>
        </div>
      </div>
      {previewItem && (
        <MediaPreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
      )}
    </div>
  );
}
