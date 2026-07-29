// PROTOTYPE (IK4Q4E) — 两个生成面板 mock：
// 1) 视频生成面板（截图 4）：参考素材行 + 工具行 + 预填正文 + 底部模型栏 + 生成按钮
// 2) 分镜图设置弹窗（截图 6）：图片模型 / 分辨率 / 比例 / 关键时刻 / 目标时长
"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Image as ImageIcon,
  Clapperboard,
  ChevronDown,
  Expand,
  Camera,
  Video,
  Palette,
  Plus,
} from "lucide-react";
import { extractAssetRefs } from "./mock";
import { RichPromptInput } from "./editor";

/** mock 原始宽高比：按素材 id 稳定取一个（真实实现读素材元数据）。 */
const MOCK_RATIOS: Array<[number, number]> = [
  [16, 9],
  [4, 3],
  [1, 1],
  [3, 4],
];
function mockAspect(assetId: string): [number, number] {
  const sum = [...assetId].reduce((a, c) => a + c.charCodeAt(0), 0);
  return MOCK_RATIOS[sum % MOCK_RATIOS.length];
}

/** 参考素材缩略图（可移除，mock）。悬停浮出放大预览，保持原始比例（批注）。
 *  预览用 fixed 定位：所在行 overflow-x-auto 会同时裁剪 y 方向（批注：悬浮不显示）。 */
function RefThumb({ label, assetId }: { label: string; assetId: string }) {
  const [gone, setGone] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, h] = mockAspect(assetId);
  const previewH = Math.round((128 * h) / w);
  if (gone) return null;
  return (
    <div
      ref={wrapRef}
      className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-lg"
      style={{
        backgroundImage:
          "linear-gradient(135deg, var(--tc-bg-elevated) 0%, var(--tc-bg-surface) 50%, var(--tc-bg-elevated) 100%)",
        border: "1px solid var(--tc-border-subtle)",
      }}
      title={label}
      onMouseEnter={() => {
        const r = wrapRef.current?.getBoundingClientRect();
        if (r) setPos({ x: r.left, y: r.top - previewH - 6 });
      }}
      onMouseLeave={() => setPos(null)}
    >
      <ImageIcon
        width={18}
        height={18}
        stroke="var(--tc-text-muted)"
        strokeWidth={1.2}
      />
      <button
        type="button"
        aria-label={`移除 ${label}`}
        onClick={() => setGone(true)}
        className="absolute top-0.5 right-0.5 z-10 flex h-4 w-4 items-center justify-center rounded-full"
        style={{
          background: "var(--tc-bg-overlay)",
          border: 0,
          color: "var(--tc-text-secondary)",
        }}
      >
        <X width={10} height={10} />
      </button>
      <span
        className="absolute bottom-0.5 left-1 text-[9px]"
        style={{ color: "var(--tc-text-tertiary)" }}
      >
        {label}
      </span>
      {/* 悬停放大预览：宽度固定，高度按原始比例。
          portal 到 body：面板根有 translate，fixed 会相对它解析（批注：错位） */}
      {pos &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[60] overflow-hidden rounded-lg"
            style={{
              left: pos.x,
              top: pos.y,
              width: 128,
              height: previewH,
              backgroundImage:
                "linear-gradient(135deg, var(--tc-bg-elevated) 0%, var(--tc-bg-surface) 50%, var(--tc-bg-elevated) 100%)",
              border: "1px solid var(--tc-border-active)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}
          >
            <div className="flex h-full w-full items-center justify-center">
              <ImageIcon
                width={24}
                height={24}
                stroke="var(--tc-text-muted)"
                strokeWidth={1.2}
              />
            </div>
            <span
              className="absolute bottom-1 left-1.5 text-[10px]"
              style={{ color: "var(--tc-text-tertiary)" }}
            >
              {label} · {w}:{h}
            </span>
          </div>,
          document.body,
        )}
    </div>
  );
}

const MODEL_OPTIONS = ["Seedance 2.0", "Seedance 1.5", "Kling 3.0"];
const MODE_OPTIONS = ["全能参考", "首尾帧"];
const RESOLUTION_OPTIONS = ["720p", "1080p", "4K"];
const RATIO_OPTIONS = ["9:16", "3:4", "1:1", "4:3", "16:9", "21:9"];
/** 首尾帧模式：不支持 21:9，且宽高比自动跟随首帧图（mock 首帧比例 16:9）。 */
const FIRST_FRAME_RATIO = "16:9";

/** 设置面板内的下拉选择（模型 / 模式 / 分辨率）。 */
function SettingSelect({
  value,
  options,
  onChange,
  flex,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  flex?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" style={flex ? { flex: 1 } : undefined}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-[12.5px]"
        style={{
          background: "var(--tc-bg-canvas)",
          border: "1px solid var(--tc-border-subtle)",
          color: "var(--tc-text-primary)",
        }}
      >
        {value}
        <ChevronDown width={13} height={13} stroke="var(--tc-text-muted)" />
      </button>
      {open && (
        <>
          {/* 点击下拉框外任意区域收起（仅收下拉，不动设置面板） */}
          <div
            className="fixed inset-0 z-[15]"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className="absolute top-full right-0 left-0 z-20 mt-1 flex flex-col gap-0.5 rounded-lg p-1"
            style={{
              background: "var(--tc-bg-elevated)",
              border: "1px solid var(--tc-border-subtle)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}
          >
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className="rounded-md px-2.5 py-1.5 text-left text-[12px]"
                style={{
                  background:
                    opt === value ? "var(--tc-bg-surface)" : "transparent",
                  border: 0,
                  color:
                    opt === value
                      ? "var(--tc-text-primary)"
                      : "var(--tc-text-secondary)",
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** 视频生成面板（截图批注 4）：点击「生成视频」弹出，自动预填场景卡内容。 */
export function VideoGenPanelMock({
  content,
  onClose,
  onSubmit,
}: {
  content: string;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const [model, setModel] = useState(MODEL_OPTIONS[0]);
  const [mode, setMode] = useState(MODE_OPTIONS[0]);
  const [resolution, setResolution] = useState(RESOLUTION_OPTIONS[0]);
  const [duration, setDuration] = useState(15);
  const [ratio, setRatio] = useState("16:9");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const refs = extractAssetRefs(content);
  const isFirstLastFrame = mode === "首尾帧";
  const ratioOptions = isFirstLastFrame
    ? RATIO_OPTIONS.filter((r) => r !== "21:9")
    : RATIO_OPTIONS;
  const handleModeChange = (v: string) => {
    setMode(v);
    // 首尾帧：宽高比自动跟随首帧图比例（mock 为 16:9）
    if (v === "首尾帧") setRatio(FIRST_FRAME_RATIO);
  };
  return (
    <>
      {/* 透明 backdrop：点击面板外空白区域收起（批注） */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed bottom-6 left-1/2 z-50 flex w-[760px] max-w-[94vw] -translate-x-1/2 flex-col gap-3 rounded-2xl p-4"
        style={{
          background: "var(--tc-bg-surface)",
          border: "1px solid var(--tc-border-subtle)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
        }}
      >
        {/* 参考素材行 */}
        <div className="flex items-center gap-2 overflow-x-auto">
          {refs.map((r) => (
            <RefThumb key={r.assetId} label={r.label} assetId={r.assetId} />
          ))}
          {[ImageIcon, Video].map((Icon, i) => (
            <button
              key={i}
              type="button"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: "var(--tc-bg-elevated)",
                border: "1px dashed var(--tc-border-active)",
                color: "var(--tc-text-muted)",
              }}
            >
              <Icon width={18} height={18} strokeWidth={1.2} />
            </button>
          ))}
          <span
            className="ml-auto text-[11px]"
            style={{ color: "var(--tc-text-muted)" }}
          >
            {refs.length}/15
          </span>
          <Expand
            width={14}
            height={14}
            stroke="var(--tc-text-muted)"
            className="shrink-0"
          />
        </div>

        {/* 工具行 */}
        <div className="flex gap-2">
          {[
            { icon: Camera, label: "摄像机" },
            { icon: Video, label: "运镜" },
            { icon: Palette, label: "风格" },
          ].map((t) => (
            <span
              key={t.label}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px]"
              style={{
                background: "var(--tc-bg-elevated)",
                border: "1px solid var(--tc-border-subtle)",
                color: "var(--tc-text-secondary)",
              }}
            >
              <t.icon width={13} height={13} />
              {t.label}
            </span>
          ))}
        </div>

        {/* 预填正文（场景卡内容全文载入，可调整，仅影响本次生成）。
          与卡片编辑同规：富文本呈现，素材引用为缩略图 chip（批注）。 */}
        <RichPromptInput
          initialMarkdown={content}
          className="flex h-[240px] w-full flex-col gap-3 overflow-y-auto rounded-xl p-3 outline-none"
          style={{
            background: "var(--tc-bg-canvas)",
            border: "1px solid var(--tc-border-subtle)",
          }}
        />

        {/* 设置面板打开时：点面板内其他区域只收起设置，不收起整个面板 */}
        {settingsOpen && (
          <div
            className="absolute inset-0 z-[5] rounded-2xl"
            onClick={() => setSettingsOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* 生成参数设置弹出层：点底部参数摘要展开（批注：可参考对象样式） */}
        {settingsOpen && (
          <div
            className="absolute bottom-14 left-4 z-10 flex w-[560px] max-w-[calc(100%-2rem)] flex-col gap-3 rounded-2xl p-4"
            style={{
              background: "var(--tc-bg-elevated)",
              border: "1px solid var(--tc-border-subtle)",
              boxShadow: "0 12px 36px rgba(0,0,0,0.55)",
            }}
          >
            <div className="flex flex-col gap-1.5">
              <span
                className="text-[11px]"
                style={{ color: "var(--tc-text-muted)" }}
              >
                模型和模式
              </span>
              <div className="flex gap-2">
                <SettingSelect
                  value={model}
                  options={MODEL_OPTIONS}
                  onChange={setModel}
                  flex
                />
                <SettingSelect
                  value={mode}
                  options={MODE_OPTIONS}
                  onChange={handleModeChange}
                  flex
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span
                className="text-[11px]"
                style={{ color: "var(--tc-text-muted)" }}
              >
                分辨率
              </span>
              <SettingSelect
                value={resolution}
                options={RESOLUTION_OPTIONS}
                onChange={setResolution}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span
                  className="text-[11px]"
                  style={{ color: "var(--tc-text-muted)" }}
                >
                  时长
                </span>
                <span
                  className="rounded-md px-2 py-0.5 text-[11px]"
                  style={{
                    background: "var(--tc-bg-surface)",
                    color: "var(--tc-text-primary)",
                  }}
                >
                  {duration}s
                </span>
              </div>
              <input
                type="range"
                min={4}
                max={15}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full"
                style={{ accentColor: "var(--tc-accent)" }}
                aria-label="时长"
              />
              <div
                className="flex justify-between text-[10px]"
                style={{ color: "var(--tc-text-muted)" }}
              >
                <span>4s</span>
                <span>15s</span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span
                  className="text-[11px]"
                  style={{ color: "var(--tc-text-muted)" }}
                >
                  宽高比
                </span>
                {isFirstLastFrame && (
                  <span
                    className="text-[10px]"
                    style={{ color: "var(--tc-text-muted)" }}
                  >
                    已跟随首帧图比例
                  </span>
                )}
              </div>
              <div className="flex gap-1.5">
                {ratioOptions.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRatio(r)}
                    className="flex-1 rounded-lg px-2 py-1.5 text-[11.5px]"
                    style={{
                      background:
                        ratio === r
                          ? "var(--tc-bg-surface)"
                          : "var(--tc-bg-canvas)",
                      border:
                        ratio === r
                          ? "1px solid var(--tc-border-active)"
                          : "1px solid var(--tc-border-subtle)",
                      color:
                        ratio === r
                          ? "var(--tc-text-primary)"
                          : "var(--tc-text-tertiary)",
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 底部模型栏：参数摘要可点击，弹出设置；改动实时回显到摘要 */}
        <div className="relative z-10 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg px-2 py-1"
            style={{
              background: settingsOpen
                ? "var(--tc-bg-elevated)"
                : "transparent",
              border: 0,
            }}
          >
            <Clapperboard width={14} height={14} stroke="var(--tc-accent)" />
            <span
              className="text-[12px]"
              style={{ color: "var(--tc-text-secondary)" }}
            >
              {model} · {ratio} · {resolution} · {duration}s
            </span>
          </button>
          <div className="flex items-center gap-3">
            <span
              className="text-[11px]"
              style={{ color: "var(--tc-text-muted)" }}
            >
              提交后无法取消
            </span>
            <span
              className="text-[12px]"
              style={{ color: "var(--tc-text-tertiary)" }}
            >
              1x
            </span>
            <button
              type="button"
              onClick={onSubmit}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12.5px]"
              style={{
                background: "var(--tc-accent)",
                color: "var(--tc-text-primary)",
                border: 0,
              }}
            >
              <Plus width={13} height={13} />
              生成
            </button>
            <button
              type="button"
              aria-label="收起"
              onClick={onClose}
              style={{
                background: "transparent",
                border: 0,
                color: "var(--tc-text-muted)",
              }}
            >
              <ChevronDown width={15} height={15} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/** 分镜图设置弹窗（截图批注 6）。 */
export function StoryboardSettingsMock({
  onClose,
  onGenerate,
}: {
  onClose: () => void;
  onGenerate: () => void;
}) {
  const [keyMoments, setKeyMoments] = useState("自动");
  const select = (label: string, value: string) => (
    <div key={label} className="flex flex-col gap-1">
      <span className="text-[11px]" style={{ color: "var(--tc-text-muted)" }}>
        {label}
      </span>
      <button
        type="button"
        className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px]"
        style={{
          background: "var(--tc-bg-canvas)",
          border: "1px solid var(--tc-border-subtle)",
          color: "var(--tc-text-primary)",
          minWidth: 100,
        }}
      >
        {value}
        <ChevronDown width={12} height={12} stroke="var(--tc-text-muted)" />
      </button>
    </div>
  );
  return (
    <>
      {/* 透明 backdrop：点击弹窗外空白区域收起（同批注） */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed bottom-6 left-1/2 z-50 flex w-[420px] max-w-[92vw] -translate-x-1/2 flex-col gap-3 rounded-2xl p-4"
        style={{
          background: "var(--tc-bg-surface)",
          border: "1px solid var(--tc-border-subtle)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
        }}
      >
        <div className="flex items-center justify-between">
          <span
            className="text-[13px] font-medium"
            style={{ color: "var(--tc-text-primary)" }}
          >
            分镜
          </span>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            style={{
              background: "transparent",
              border: 0,
              color: "var(--tc-text-muted)",
            }}
          >
            <X width={15} height={15} />
          </button>
        </div>
        <div className="flex gap-2">
          {select("图片模型", "GPT Image 2")}
          {select("分辨率", "2K")}
          {select("比例", "16:9")}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex flex-col gap-1">
            <span
              className="text-[11px]"
              style={{ color: "var(--tc-text-muted)" }}
            >
              关键时刻
            </span>
            <div className="flex gap-1.5">
              {["自动", "4", "9", "25", "自定义"].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKeyMoments(k)}
                  className="rounded-lg px-2.5 py-1.5 text-[12px]"
                  style={{
                    background:
                      keyMoments === k
                        ? "var(--tc-bg-elevated)"
                        : "var(--tc-bg-canvas)",
                    border:
                      keyMoments === k
                        ? "1px solid var(--tc-border-active)"
                        : "1px solid var(--tc-border-subtle)",
                    color: "var(--tc-text-primary)",
                  }}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span
              className="text-[11px]"
              style={{ color: "var(--tc-text-muted)" }}
            >
              目标时长
            </span>
            <span
              className="rounded-lg px-2.5 py-1.5 text-[12px]"
              style={{
                background: "var(--tc-bg-canvas)",
                border: "1px solid var(--tc-border-subtle)",
                color: "var(--tc-text-primary)",
              }}
            >
              15 秒
            </span>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onGenerate}
            className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[12.5px]"
            style={{
              background: "var(--tc-accent)",
              color: "var(--tc-text-primary)",
              border: 0,
            }}
          >
            <Plus width={13} height={13} />
            生成分镜图
          </button>
        </div>
      </div>
    </>
  );
}
