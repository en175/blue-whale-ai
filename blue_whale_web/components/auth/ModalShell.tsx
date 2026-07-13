"use client";
/**
 * ModalShell —— 账号中心 modal 通用外壳。
 *
 * 封装复刻自 LoginModal 的范式：遮罩层（点外部关闭）+ 对话框卡 + 右上 X + ESC 关闭。
 * 4 个账号中心 modal（Profile/History/Account/RebindPhone）共用此壳，消除字节级重复。
 * LoginModal 暂不改用（其重构另开工单，避免动已测代码）。
 *
 * 不内置标题：<h2> 由 children 自由渲染（RebindPhone 有步骤计数等复杂标题区）。
 * 不内置内容：children 自由。
 */
import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalShellProps {
  /** 无障碍标签 + X 按钮的 aria-label 前缀（如「账号信息」→「关闭账号信息」） */
  ariaLabel: string;
  onClose: () => void;
  children: ReactNode;
  /** z-index，默认 2147483610；嵌套 modal（如换绑盖在账号信息上）传更高值 */
  zIndex?: number;
  /** 卡片宽度，默认 420 */
  width?: number;
  /** 是否响应 ESC 关闭，默认 true；嵌套子 modal 打开时父 modal 传 false 避免双重关闭 */
  closeOnEscape?: boolean;
}

export function ModalShell({
  ariaLabel,
  onClose,
  children,
  zIndex = 2147483610,
  width = 420,
  closeOnEscape = true,
}: ModalShellProps) {
  // ESC 关闭（mount 即监听，卸载即清）。子 modal 打开时父 modal 通过 closeOnEscape=false 暂停
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
      className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 motion-reduce:animate-none"
      style={{ zIndex }}
      onClick={onClose}
    >
      <div
        className="bg-[var(--tc-login-modal-bg)] border border-white/[0.12] rounded-xl shadow-[var(--tc-modal-shadow)] max-w-[calc(100vw-32px)] p-10 px-8 relative animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute top-3 right-3 inline-flex w-8 h-8 items-center justify-center rounded-lg text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors duration-150"
          aria-label={`关闭${ariaLabel}`}
          onClick={onClose}
        >
          <X size={16} />
        </button>
        {children}
      </div>
    </div>
  );
}
