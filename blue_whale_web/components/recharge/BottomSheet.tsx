"use client";
/**
 * BottomSheet — 移动端底部抽屉
 *
 * 复刻 ModalShell 的 ESC/overlay 关闭范式，但从底部滑入。
 * 用于移动端 RechargeModal 替代 ModalShell 布局。
 *
 * Features:
 * - 从底部滑入（slide-in-from-bottom 动画）
 * - 半透明遮罩 + 点遮罩关闭
 * - ESC 关闭
 * - 顶部拖拽手柄（视觉提示可下滑关闭）
 * - 圆角顶部、max-h 限制防止溢出
 * - zIndex 默认为 ModalShell 嵌套级（2147483612）
 */
import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface BottomSheetProps {
  ariaLabel: string;
  onClose: () => void;
  children: ReactNode;
  zIndex?: number;
  closeOnEscape?: boolean;
}

export function BottomSheet({
  ariaLabel,
  onClose,
  children,
  zIndex = 2147483612,
  closeOnEscape = true,
}: BottomSheetProps) {
  // ESC 关闭
  useEffect(() => {
    if (!closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, closeOnEscape]);

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 motion-reduce:animate-none"
      style={{ zIndex }}
      onClick={onClose}
    >
      <div
        className="absolute inset-x-0 bottom-0 bg-[var(--tc-login-modal-bg,#1e1e1e)] border border-white/[0.12] border-b-0 rounded-t-2xl max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom duration-300 motion-reduce:animate-none"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 拖拽手柄 */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* 关闭按钮 */}
        <button
          type="button"
          className="absolute top-3 right-3 inline-flex w-8 h-8 items-center justify-center rounded-lg text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors duration-150"
          aria-label={`关闭${ariaLabel}`}
          onClick={onClose}
        >
          <X size={16} />
        </button>

        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}
