"use client";
/**
 * AudioDockContent —— AI 音频生成 Dock（IJZXW7-B 占位）。
 * 后端无音频生成 provider，模型/参数 mock；prompt + 参考素材 + 生成。仿 ImageDockContent 结构。
 * 后端音频生成就绪后：mock 模型列表换 catalog，onGenerate 经 page 接真 generateAudio（签名不变）。
 */
import { useEffect, useRef, useState } from "react";
import { AudioLines, ChevronDown, Plus, X } from "lucide-react";
import { CreditIcon } from "../../icons";
import type {
  AudioDockContentProps,
  AudioGenerateSettings,
  SelectOption,
} from "../../types";
import { DockMediaThumb } from "./parts";
import { UploadSourceMenu } from "./UploadSourceMenu";

/** mock 音频模型（后端无音频生成；就绪换 catalog）。 */
const MOCK_AUDIO_MODELS: SelectOption[] = [
  { id: "mock-tts-v1", label: "语音 TTS（mock）" },
  { id: "mock-music-v1", label: "音乐（mock）" },
  { id: "mock-sfx-v1", label: "音效（mock）" },
];
const MOCK_DURATIONS = [5, 10, 30];
const MOCK_FORMATS: SelectOption[] = [
  { id: "mp3", label: "mp3" },
  { id: "wav", label: "wav" },
];
const MOCK_SAMPLE_RATE = 44100;

export function AudioDockContent({
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
  prefillSignal,
}: AudioDockContentProps) {
  const [model, setModel] = useState<SelectOption>(MOCK_AUDIO_MODELS[0]);
  const [duration, setDuration] = useState<number>(5);
  const [format, setFormat] = useState<SelectOption>(MOCK_FORMATS[0]);
  const [modelOpen, setModelOpen] = useState(false);

  const localFileRef = useRef<HTMLInputElement>(null);
  const placeholderRef = useRef<HTMLButtonElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const uploadTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);

  // 重新编辑预填（recipe → audio 模型/时长/格式）
  useEffect(() => {
    if (!prefillSignal?.prefill) return;
    const p = prefillSignal.prefill;
    if (p.modelId) {
      const m = MOCK_AUDIO_MODELS.find((mm) => mm.id === p.modelId);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (m) setModel(m);
    }
    if (typeof p.duration === "number") {
       
      setDuration(p.duration);
    }
    if (p.format) {
      const f = MOCK_FORMATS.find((ff) => ff.id === p.format);
       
      if (f) setFormat(f);
    }
  }, [prefillSignal?.nonce]);

  const openUploadMenuFrom = (
    ref: React.RefObject<HTMLButtonElement | null>,
  ) => {
    uploadTriggerRef.current = ref.current;
    setUploadMenuOpen(true);
  };
  const handleTriggerClick = (
    ref: React.RefObject<HTMLButtonElement | null>,
  ) => {
    if (isPicking) {
      onExitPick?.();
      return;
    }
    openUploadMenuFrom(ref);
  };
  const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) onLocalUpload?.(files[i]);
    e.target.value = "";
  };

  // 模型下拉点外关闭
  useEffect(() => {
    if (!modelOpen) return;
    const h = (e: MouseEvent) => {
      if (modelBtnRef.current?.contains(e.target as Node)) return;
      setModelOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [modelOpen]);

  return (
    <>
      <input
        ref={localFileRef}
        type="file"
        accept="audio/*"
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
        }}
      >
        <div style={{ position: "relative" }}>
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
              }}
            >
              <X width={13} height={13} />
            </button>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              flexWrap: "wrap",
              gap: 8,
              paddingLeft: 8,
              paddingTop: 4,
            }}
          >
            {media.map((item) => (
              <DockMediaThumb
                key={item.id}
                item={item}
                onRemove={onRemoveMedia}
              />
            ))}
            <button
              ref={placeholderRef}
              type="button"
              aria-label="上传参考音频"
              onClick={() => handleTriggerClick(placeholderRef)}
              style={{
                width: 44,
                height: 44,
                padding: 0,
                borderRadius: 9,
                border: "1px solid rgba(255, 255, 255, 0.02)",
                background: "rgba(255, 255, 255, 0.043)",
                color: "rgba(255, 255, 255, 0.62)",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <AudioLines
                width={18}
                height={18}
                stroke="currentColor"
                strokeWidth={1.8}
              />
            </button>
          </div>
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
                padding: "6px 8px",
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
                描述要生成的音频（旁白 / 音乐 / 音效）...
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          padding: "8px 8px 8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          position: "relative",
        }}
      >
        <button
          ref={plusRef}
          type="button"
          aria-label="上传音频"
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
          }}
        >
          <Plus width={14} height={14} />
        </button>

        {/* 模型选择（mock 下拉） */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button
            ref={modelBtnRef}
            type="button"
            aria-label="音频模型（mock）"
            aria-haspopup="listbox"
            aria-expanded={modelOpen}
            onClick={() => setModelOpen((v) => !v)}
            style={{
              height: 32,
              borderRadius: 8,
              padding: "0 8px",
              border: 0,
              background: "var(--tc-dock-control-bg, transparent)",
              color: "rgba(255, 255, 255, 0.85)",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              whiteSpace: "nowrap",
            }}
          >
            <AudioLines
              width={14}
              height={14}
              stroke="currentColor"
              strokeWidth={2}
            />
            <span>{model.label}</span>
            <ChevronDown width={12} height={12} />
          </button>
          {modelOpen && (
            <div
              role="listbox"
              aria-label="音频模型"
              style={{
                position: "absolute",
                bottom: "calc(100% + 4px)",
                left: 0,
                minWidth: 160,
                padding: 4,
                borderRadius: 8,
                background: "rgb(30, 30, 30)",
                border: "1px solid rgba(255, 255, 255, 0.04)",
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25)",
                zIndex: 2147483602,
                display: "flex",
                flexDirection: "column",
                gap: 0,
              }}
            >
              {MOCK_AUDIO_MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={m.id === model.id}
                  onClick={() => {
                    setModel(m);
                    setModelOpen(false);
                  }}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    border: 0,
                    borderRadius: 6,
                    background:
                      m.id === model.id
                        ? "rgba(255, 255, 255, 0.08)"
                        : "transparent",
                    color:
                      m.id === model.id
                        ? "rgba(255, 255, 255, 0.85)"
                        : "rgba(255, 255, 255, 0.45)",
                    fontSize: 12,
                    cursor: "pointer",
                    textAlign: "left",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 时长选择（按钮组，mock） */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            flexShrink: 0,
          }}
        >
          {MOCK_DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={d === duration}
              onClick={() => setDuration(d)}
              style={{
                height: 28,
                padding: "0 8px",
                borderRadius: 6,
                border: 0,
                background:
                  d === duration ? "rgba(255, 255, 255, 0.08)" : "transparent",
                color:
                  d === duration
                    ? "rgba(255, 255, 255, 0.85)"
                    : "rgba(255, 255, 255, 0.45)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {d}s
            </button>
          ))}
        </div>

        {/* 格式选择（按钮组，mock） */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            flexShrink: 0,
          }}
        >
          {MOCK_FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={f.id === format.id}
              onClick={() => setFormat(f)}
              style={{
                height: 28,
                padding: "0 8px",
                borderRadius: 6,
                border: 0,
                background:
                  f.id === format.id
                    ? "rgba(255, 255, 255, 0.08)"
                    : "transparent",
                color:
                  f.id === format.id
                    ? "rgba(255, 255, 255, 0.85)"
                    : "rgba(255, 255, 255, 0.45)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div style={{ flex: "1 1 0%" }} />

        {/* mock 标识 + 生成 */}
        <span
          style={{
            fontSize: 11,
            color: "var(--tc-text-muted)",
            marginRight: 4,
          }}
        >
          模拟生成
        </span>
        <button
          type="button"
          disabled={isEmpty || generating}
          onClick={() =>
            onGenerate?.({
              model,
              duration,
              sampleRate: MOCK_SAMPLE_RATE,
              format,
            })
          }
          style={{
            height: 32,
            padding: "0 14px",
            borderRadius: 8,
            border: 0,
            fontSize: 12,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 6,
            background:
              isEmpty || generating
                ? "rgba(255, 255, 255, 0.06)"
                : "var(--tc-accent)",
            color:
              isEmpty || generating
                ? "rgba(255, 255, 255, 0.32)"
                : "rgb(255, 255, 255)",
            cursor: isEmpty || generating ? "default" : "pointer",
          }}
        >
          <CreditIcon size={14} />
          <span>生成</span>
        </button>
      </div>
    </>
  );
}
