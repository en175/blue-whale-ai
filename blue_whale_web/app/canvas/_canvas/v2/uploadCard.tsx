/**
 * 上传占位卡（IK55VE 评审定稿变体 C：缩略图遮罩）。
 *
 * 仅 `data.recipe.origin === "uploaded"` 的 running/error 节点使用；
 * 生成卡走 MediaStateBody 旧路径，外观不变。设计 token 一律 var(--tc-*)。
 *
 * - running：本地缩略图（图片 object URL / 视频 <video> 首帧）+ 暗色遮罩（--tc-bg-overlay）
 *   + 遮罩中央白色进度环 + 环内百分比 + 下方「上传中」。
 * - error：缩略图 + destructive 55% 半透明遮罩 + 错误文案 + 圆形图标按钮
 *   （RefreshCw=重试 / X=移除，aria-label + hover tooltip）。
 */
"use client";

import { RefreshCw, X } from "lucide-react";

/** SVG 环形进度（stroke-dasharray 方案，抄自原型 ProgressRing）。 */
function ProgressRing({
  size,
  stroke,
  progress,
  color,
}: {
  size: number;
  stroke: number;
  progress: number;
  color: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--tc-border-active)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(100, Math.max(0, progress)) / 100)}
        style={{ transition: "stroke-dashoffset 150ms linear" }}
      />
    </svg>
  );
}

export type UploadCardBodyProps = {
  kind: "image" | "video" | "audio";
  status: "running" | "error";
  /** 0-100，缺省按 0 渲染。 */
  progress?: number;
  errorMessage?: string;
  /** 本地预览 object URL；音频/缺失时回退渐变占位。 */
  previewUrl?: string;
  onRetry?: () => void;
  onRemove?: () => void;
};

export function UploadCardBody({
  kind,
  status,
  progress,
  errorMessage,
  previewUrl,
  onRetry,
  onRemove,
}: UploadCardBodyProps) {
  const pct = Math.round(typeof progress === "number" ? progress : 0);
  const thumb =
    previewUrl && kind !== "audio" ? (
      kind === "video" ? (
        <video
          src={previewUrl}
          muted
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <img
          src={previewUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )
    ) : (
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(135deg, var(--tc-bg-elevated) 0%, var(--tc-bg-surface) 50%, var(--tc-bg-elevated) 100%)",
        }}
      />
    );

  if (status === "error") {
    return (
      <div
        data-testid="upload-card-error"
        className="relative h-full w-full overflow-hidden rounded-lg"
      >
        {thumb}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center"
          style={{
            background:
              "color-mix(in srgb, var(--tc-destructive) 55%, transparent)",
          }}
        >
          <span
            className="text-xs leading-4"
            style={{ color: "var(--tc-text-primary)" }}
          >
            {errorMessage || "上传失败"}
          </span>
          <div className="mt-1 flex items-center gap-2.5">
            {[
              {
                icon: <RefreshCw width={14} height={14} />,
                tip: "重试",
                run: onRetry,
              },
              {
                icon: <X width={14} height={14} />,
                tip: "移除",
                run: onRemove,
              },
            ].map((b) => (
              <span key={b.tip} className="group relative">
                <button
                  type="button"
                  aria-label={b.tip}
                  onClick={b.run}
                  className="nodrag flex h-8 w-8 items-center justify-center rounded-full"
                  style={{
                    border: "1px solid var(--tc-border-active)",
                    background: "var(--tc-bg-overlay)",
                    color: "var(--tc-text-primary)",
                  }}
                >
                  {b.icon}
                </button>
                <span
                  className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 hidden -translate-x-1/2 rounded-md px-2 py-0.5 text-[11px] whitespace-nowrap group-hover:block"
                  style={{
                    background: "var(--tc-bg-elevated)",
                    border: "1px solid var(--tc-border-subtle)",
                    color: "var(--tc-text-secondary)",
                  }}
                >
                  {b.tip}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="upload-card-running"
      className="relative h-full w-full overflow-hidden rounded-lg"
    >
      {thumb}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-1.5"
        style={{ background: "var(--tc-bg-overlay)" }}
      >
        <div className="relative flex items-center justify-center">
          <ProgressRing
            size={56}
            stroke={4}
            progress={pct}
            color="var(--tc-text-primary)"
          />
          <span
            className="absolute text-[13px] font-medium tabular-nums"
            style={{ color: "var(--tc-text-primary)" }}
          >
            {pct}%
          </span>
        </div>
        <span
          className="text-[11px]"
          style={{ color: "var(--tc-text-secondary)" }}
        >
          上传中
        </span>
      </div>
    </div>
  );
}
