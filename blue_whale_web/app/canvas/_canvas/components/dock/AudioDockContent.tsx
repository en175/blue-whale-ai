"use client";
/**
 * AudioDockContent —— 音频 Dock 双子面板（IK55VM）。
 * 音频生成（mode=audio）：音频参考槽 + 图片参考槽（均可选，本地上传/画布选取双通道）+ prompt。
 * AI 音乐（mode=music）：参考音频槽（可选）+ 曲风 prompt + 独立歌词区 + 纯伴奏开关（开则歌词禁用）+ 数量选择。
 * 底栏统一：模式切换下拉（与工具栏悬浮列表同一份清单）+ 模型下拉（各 1 个 mock 模型）+ 生成按钮（带积分标识）。
 * 不设显式时长/格式控件：时长上限 120s 由模型能力决定，输出默认 mp3（IK54R1 决议）。
 * 未提交输入全部由 BottomDock 提升持有（panel/setPanel），切子模式/关板/切模式往返不丢（IK55VF keep-alive）。
 * 后端无音频生成 provider：模型/生成 mock；就绪后模型换 catalog、onGenerate 接真接口（签名不变）。
 */
import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  ChevronDown,
  Image as ImageIcon,
  Music,
  X,
} from "lucide-react";
import { CreditIcon } from "../../icons";
import type {
  AudioDockContentProps,
  AudioSubMode,
  SelectOption,
} from "../../types";
import { AUDIO_SUB_MODES } from "../../constants";
import { DockMediaThumb } from "./parts";
import { UploadSourceMenu } from "./UploadSourceMenu";

/** mock 音频模型（IK55VM：各子模式挂 1 个；后端就绪换 catalog）。 */
export const MOCK_AUDIO_MODEL: SelectOption = {
  id: "mock-audio-v1",
  label: "音频模型（mock）",
};
export const MOCK_MUSIC_MODEL: SelectOption = {
  id: "mock-music-v1",
  label: "音乐模型（mock）",
};

/** 子功能清单来自 constants.AUDIO_SUB_MODES（与工具栏悬浮列表同一份）。 */
export const MUSIC_QUANTITIES = ["1x", "2x", "3x", "4x"];

const AUDIO_PROMPT_PLACEHOLDER =
  "描述想生成的音频：可生成音乐、音效、台词、多人对话等任意类型。支持音频或图片参考。最长 120 秒。";
const MUSIC_PROMPT_PLACEHOLDER = "描述音乐曲风、情绪、节奏和乐器等...";
const LYRICS_PLACEHOLDER = "输入或粘贴歌词...";

/** 底栏通用小下拉（向上展开，点外/Esc 关闭）。 */
function MiniDropdown({
  label,
  options,
  value,
  onChange,
  icon,
  ariaLabel,
}: {
  label: string;
  options: SelectOption[];
  value: string;
  onChange: (id: string) => void;
  icon?: React.ReactNode;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      // 容器包住按钮+列表：点选项不算点外（真实浏览器 mousedown 先于 click）
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open]);
  return (
    <div ref={wrapRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
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
        {icon}
        <span>{label}</span>
        <ChevronDown width={12} height={12} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          style={{
            position: "absolute",
            bottom: "calc(100% + 4px)",
            left: 0,
            minWidth: 120,
            padding: 4,
            borderRadius: 8,
            background: "rgb(30, 30, 30)",
            border: "1px solid rgba(255, 255, 255, 0.04)",
            boxShadow: "var(--tc-dropdown-shadow-up)",
            zIndex: 2147483602,
            display: "flex",
            flexDirection: "column",
            gap: 0,
          }}
        >
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === value}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
              style={{
                width: "100%",
                padding: "7px 10px",
                border: 0,
                borderRadius: 6,
                background:
                  o.id === value ? "rgba(255, 255, 255, 0.08)" : "transparent",
                color:
                  o.id === value
                    ? "rgba(255, 255, 255, 0.85)"
                    : "rgba(255, 255, 255, 0.45)",
                fontSize: 12,
                cursor: "pointer",
                textAlign: "left",
                whiteSpace: "nowrap",
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type SlotKind = "audioRef" | "audioImageRef";

export function AudioDockContent({
  panel,
  setPanel,
  onClose,
  media = [],
  onRemoveMedia,
  onLocalUpload,
  onPickSlot,
  onExitPick,
  onPreviewMedia,
  isPicking = false,
  onGenerate,
  generating = false,
}: AudioDockContentProps) {
  const audioFileRef = useRef<HTMLInputElement>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const audioSlotRef = useRef<HTMLButtonElement>(null);
  const imageSlotRef = useRef<HTMLButtonElement>(null);
  const uploadTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [activeSlot, setActiveSlot] = useState<SlotKind>("audioRef");

  const isMusic = panel.subMode === "music";
  const model = isMusic ? panel.musicModel : panel.audioModel;
  const prompt = isMusic ? panel.musicPrompt : panel.audioPrompt;

  // 参考槽：media 按类型分槽；music 模式只用音频参考
  const audioRefItems = media.filter((m) => m.type === "audio");
  const imageRefItems = media.filter((m) => m.type === "image");
  const refItems = isMusic
    ? audioRefItems
    : [...audioRefItems, ...imageRefItems];

  const openUploadMenu = (
    slot: SlotKind,
    ref: React.RefObject<HTMLButtonElement | null>,
  ) => {
    if (isPicking) {
      onExitPick?.();
      return;
    }
    setActiveSlot(slot);
    uploadTriggerRef.current = ref.current;
    setUploadMenuOpen(true);
  };

  const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) onLocalUpload?.(files[i]);
    e.target.value = "";
  };

  const handleGenerate = () => {
    onGenerate?.({
      mode: panel.subMode,
      model,
      lyrics: isMusic && !panel.instrumental ? panel.lyrics : undefined,
      instrumental: isMusic ? panel.instrumental : undefined,
      quantity: isMusic ? panel.quantity : undefined,
      references: refItems.map((m) => ({
        kind: m.type,
        assetId: m.assetId,
        url: m.src,
      })),
    });
  };

  const slotButtonStyle: React.CSSProperties = {
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
  };

  const promptArea = (
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    opts?: { minHeight?: number; disabled?: boolean; ariaLabel?: string },
  ) => (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={opts?.disabled}
      aria-label={opts?.ariaLabel}
      className="tc-panel-textarea-scrollbar"
      style={{
        width: "100%",
        minHeight: opts?.minHeight ?? 56,
        maxHeight: 200,
        overflowY: "auto",
        padding: "6px 8px",
        background: "transparent",
        color: "rgb(255, 255, 255)",
        fontSize: 14,
        lineHeight: "22px",
        outline: "none",
        border: 0,
        resize: "none",
        wordBreak: "break-word",
        boxSizing: "border-box",
        fontFamily: "inherit",
        opacity: opts?.disabled ? 0.4 : 1,
      }}
    />
  );

  return (
    <>
      <input
        ref={audioFileRef}
        type="file"
        accept="audio/*"
        multiple
        className="sr-only"
        aria-hidden="true"
        onChange={handleLocalFileChange}
      />
      <input
        ref={imageFileRef}
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
        onLocalUpload={() =>
          (activeSlot === "audioRef"
            ? audioFileRef
            : imageFileRef
          ).current?.click()
        }
        onPickFromCanvas={() => onPickSlot?.(activeSlot)}
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
          {/* 参考槽：音频参考 +（audio 模式）图片参考，均可选，双通道 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
              paddingLeft: 8,
              paddingTop: 4,
            }}
          >
            {audioRefItems.map((item) => (
              <DockMediaThumb
                key={item.id}
                item={item}
                onRemove={onRemoveMedia}
                onPreview={onPreviewMedia}
              />
            ))}
            <button
              ref={audioSlotRef}
              type="button"
              aria-label="音频参考（可选）"
              title="音频参考（可选）"
              onClick={() => openUploadMenu("audioRef", audioSlotRef)}
              style={slotButtonStyle}
            >
              <AudioLines
                width={18}
                height={18}
                stroke="currentColor"
                strokeWidth={1.8}
              />
            </button>
            {!isMusic && (
              <>
                {imageRefItems.map((item) => (
                  <DockMediaThumb
                    key={item.id}
                    item={item}
                    onRemove={onRemoveMedia}
                    onPreview={onPreviewMedia}
                  />
                ))}
                <button
                  ref={imageSlotRef}
                  type="button"
                  aria-label="图片参考（可选）"
                  title="图片参考（可选）"
                  onClick={() => openUploadMenu("audioImageRef", imageSlotRef)}
                  style={slotButtonStyle}
                >
                  <ImageIcon
                    width={18}
                    height={18}
                    stroke="currentColor"
                    strokeWidth={1.8}
                  />
                </button>
              </>
            )}
            <span
              style={{
                fontSize: 11,
                color: "rgba(255, 255, 255, 0.3)",
                userSelect: "none",
              }}
            >
              {isMusic ? "参考音频（可选）" : "音频参考 / 图片参考（均可选）"}
            </span>
          </div>
          <div style={{ position: "relative", flex: "1 1 0%", minWidth: 0 }}>
            {isMusic
              ? promptArea(
                  panel.musicPrompt,
                  (v) => setPanel({ musicPrompt: v }),
                  MUSIC_PROMPT_PLACEHOLDER,
                  { ariaLabel: "曲风描述" },
                )
              : promptArea(
                  panel.audioPrompt,
                  (v) => setPanel({ audioPrompt: v }),
                  AUDIO_PROMPT_PLACEHOLDER,
                  { ariaLabel: "音频描述" },
                )}
            {isMusic && (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span
                  style={{
                    fontSize: 11,
                    color: "rgba(255, 255, 255, 0.55)",
                    paddingLeft: 8,
                  }}
                >
                  歌词（可选）
                </span>
                {promptArea(
                  panel.lyrics,
                  (v) => setPanel({ lyrics: v }),
                  LYRICS_PLACEHOLDER,
                  {
                    minHeight: 44,
                    disabled: panel.instrumental,
                    ariaLabel: "歌词",
                  },
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 底栏：模式切换下拉 + 模型下拉 +（music：纯伴奏 + 数量）+ 生成按钮 */}
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
        <MiniDropdown
          ariaLabel="音频模式"
          label={
            AUDIO_SUB_MODES.find((m) => m.id === panel.subMode)?.label ?? ""
          }
          options={AUDIO_SUB_MODES}
          value={panel.subMode}
          onChange={(id) => setPanel({ subMode: id as AudioSubMode })}
          icon={
            panel.subMode === "audio" ? (
              <AudioLines
                width={14}
                height={14}
                stroke="currentColor"
                strokeWidth={2}
              />
            ) : (
              <Music
                width={14}
                height={14}
                stroke="currentColor"
                strokeWidth={2}
              />
            )
          }
        />
        <MiniDropdown
          ariaLabel="音频模型"
          label={model.label}
          options={[isMusic ? MOCK_MUSIC_MODEL : MOCK_AUDIO_MODEL]}
          value={model.id}
          onChange={(id) =>
            setPanel(
              isMusic
                ? { musicModel: { ...MOCK_MUSIC_MODEL, id } }
                : { audioModel: { ...MOCK_AUDIO_MODEL, id } },
            )
          }
        />
        {isMusic && (
          <>
            <button
              type="button"
              role="switch"
              aria-checked={panel.instrumental}
              aria-label="纯伴奏"
              onClick={() => setPanel({ instrumental: !panel.instrumental })}
              style={{
                height: 32,
                borderRadius: 8,
                padding: "0 8px",
                border: 0,
                background: "var(--tc-dock-control-bg, transparent)",
                color: panel.instrumental
                  ? "rgba(255, 255, 255, 0.85)"
                  : "rgba(255, 255, 255, 0.55)",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: "relative",
                  width: 26,
                  height: 14,
                  borderRadius: 9999,
                  background: panel.instrumental
                    ? "var(--tc-accent)"
                    : "rgba(255, 255, 255, 0.16)",
                  transition: "background 120ms",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: panel.instrumental ? 14 : 2,
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: "rgb(255, 255, 255)",
                    transition: "left 120ms",
                  }}
                />
              </span>
              纯伴奏
            </button>
            <MiniDropdown
              ariaLabel="数量"
              label={panel.quantity}
              options={MUSIC_QUANTITIES.map((q) => ({ id: q, label: q }))}
              value={panel.quantity}
              onChange={(id) => setPanel({ quantity: id })}
            />
          </>
        )}

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
          disabled={prompt.trim().length === 0 || generating}
          onClick={handleGenerate}
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
              prompt.trim().length === 0 || generating
                ? "rgba(255, 255, 255, 0.06)"
                : "var(--tc-accent)",
            color:
              prompt.trim().length === 0 || generating
                ? "rgba(255, 255, 255, 0.32)"
                : "rgb(255, 255, 255)",
            cursor:
              prompt.trim().length === 0 || generating ? "default" : "pointer",
          }}
        >
          <CreditIcon size={14} />
          <span>生成</span>
        </button>
      </div>
    </>
  );
}
