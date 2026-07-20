/**
 * FeedbackDrawer —— 右侧「意见反馈」抽屉（展示层）。
 * 点击画布右上「反馈」按钮弹出。表单：反馈类型单选 + 内容 textarea（0/200）+ 截图上传（占位）。
 * 提交先不接后端（noop → 关闭）。createPortal 渲染浮层，Esc / 点遮罩关闭。
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, X } from "lucide-react";

const FEEDBACK_TYPES = [
  { id: "bug", label: "问题反馈" },
  { id: "feature", label: "功能建议" },
  { id: "other", label: "其他" },
] as const;

const MAX_LEN = 200;

export function FeedbackDrawer({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [type, setType] = useState<string>(FEEDBACK_TYPES[0].id);
  const [content, setContent] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[400]" role="dialog" aria-modal="true" aria-label="意见反馈">
      {/* 遮罩 */}
      <div className="absolute inset-0" style={{ background: "var(--tc-bg-overlay)" }} onClick={onClose} />
      {/* 抽屉 */}
      <div
        className="absolute right-0 top-0 flex h-full flex-col tc-enter tc-enter--right"
        style={{
          width: 380,
          background: "var(--tc-bg-surface)",
          borderLeft: "1px solid var(--tc-border-subtle)",
          boxShadow: "rgba(0, 0, 0, 0.4) -8px 0 24px",
        }}
      >
        {/* 标题栏 */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--tc-border-subtle)" }}
        >
          <span className="text-[15px] font-semibold" style={{ color: "var(--tc-text-primary)" }}>
            意见反馈
          </span>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="tc-ui-glow-btn flex h-7 w-7 items-center justify-center rounded-lg hover:bg-[var(--tc-menu-item-hover)]"
            style={{ background: "transparent", border: 0, color: "var(--tc-text-secondary)", cursor: "pointer" }}
          >
            <X width={16} height={16} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
          {/* 反馈类型 */}
          <div className="flex flex-col gap-2">
            <label className="text-xs" style={{ color: "var(--tc-text-tertiary)" }}>
              反馈类型
            </label>
            <div className="flex gap-2">
              {FEEDBACK_TYPES.map((t) => {
                const active = type === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setType(t.id)}
                    className="rounded-full px-3 py-1.5 text-xs transition-colors"
                    style={{
                      background: active ? "var(--tc-accent)" : "transparent",
                      border: `1px solid ${active ? "var(--tc-accent)" : "var(--tc-border)"}`,
                      color: active ? "#fff" : "var(--tc-text-secondary)",
                      cursor: "pointer",
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 反馈内容 */}
          <div className="flex flex-col gap-2">
            <label className="text-xs" style={{ color: "var(--tc-text-tertiary)" }}>
              反馈内容
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, MAX_LEN))}
              placeholder="请输入反馈内容"
              maxLength={MAX_LEN}
              rows={6}
              className="resize-none rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--tc-bg-elevated)",
                border: "1px solid var(--tc-border)",
                color: "var(--tc-text-primary)",
              }}
            />
            <span className="self-end text-[11px] tabular-nums" style={{ color: "var(--tc-text-muted)" }}>
              {content.length}/{MAX_LEN}
            </span>
          </div>

          {/* 截图上传（占位，未接上传） */}
          <div className="flex flex-col gap-2">
            <label className="text-xs" style={{ color: "var(--tc-text-tertiary)" }}>
              截图（可选）
            </label>
            <div
              className="flex flex-col items-center justify-center gap-1.5 rounded-lg py-6"
              style={{
                border: "1px dashed var(--tc-border-active)",
                background: "var(--tc-bg-elevated)",
                color: "var(--tc-text-muted)",
              }}
            >
              <ImagePlus width={20} height={20} />
              <span className="text-xs">拖拽或点击上传截图</span>
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div
          className="flex justify-end gap-2 px-5 py-4"
          style={{ borderTop: "1px solid var(--tc-border-subtle)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm transition-colors hover:bg-[var(--tc-menu-item-hover)]"
            style={{
              background: "transparent",
              border: "1px solid var(--tc-border)",
              color: "var(--tc-text-secondary)",
              cursor: "pointer",
            }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={!content.trim()}
            onClick={() => {
              // TODO: 接后端提交反馈（type + content + 截图）
              onClose();
            }}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "var(--tc-accent)", border: 0, color: "#fff", cursor: "pointer" }}
          >
            提交
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
