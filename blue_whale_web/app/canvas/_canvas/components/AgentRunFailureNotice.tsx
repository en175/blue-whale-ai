"use client";

import { AlertCircle, RotateCcw } from "lucide-react";

/**
 * AgentRun 失败落点（IK67GZ，契约 §8.3）：失败提示不进头部，落在对话流末尾，
 * 通栏内联提示条 + 右侧幽灵风格重试按钮，点击走手动重试命令。
 */
export function AgentRunFailureNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="flex items-center gap-2 self-stretch rounded-lg px-3 py-2 text-xs leading-5"
      role="alert"
      style={{
        border: "1px solid var(--tc-border-subtle)",
        background: "var(--tc-menu-item-hover)",
      }}
    >
      <AlertCircle
        size={14}
        style={{ color: "var(--tc-destructive)", flexShrink: 0 }}
      />
      <span style={{ color: "var(--tc-text-secondary)" }}>
        生成失败，本次请求未完成
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors"
        style={{
          border: "1px solid var(--tc-border-subtle)",
          color: "var(--tc-text-primary)",
        }}
        aria-label="重试本次回答"
      >
        <RotateCcw size={12} />
        重试
      </button>
    </div>
  );
}
