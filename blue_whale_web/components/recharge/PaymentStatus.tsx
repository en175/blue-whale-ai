"use client";
/**
 * PaymentStatus — 支付状态展示
 *
 * 三态：
 * - pending: 呼吸动画 + "等待支付结果…"
 * - success: 大对勾 + "充值成功" + 获得积分 + 当前余额
 * - failed: 错误图标 + 错误信息 + 重试按钮
 */
import { useEffect, useRef } from "react";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import type { RechargeOrder } from "./types";
import { SUCCESS_AUTO_CLOSE_MS } from "./constants";

interface PaymentStatusProps {
  /** pending | success | failed（对应 QR_READY / PAYMENT_SUCCESS / PAYMENT_FAILED / CREATING_ORDER） */
  status: "pending" | "success" | "failed" | "creating";
  order: RechargeOrder | null;
  newBalance: number | null;
  error: string | null;
  onContinue: () => void;
  onRetry: () => void;
}

export function PaymentStatus({
  status,
  order,
  newBalance,
  error,
  onContinue,
  onRetry,
}: PaymentStatusProps) {
  const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 支付成功 3s 自动关闭
  useEffect(() => {
    if (status === "success") {
      autoCloseTimer.current = setTimeout(onContinue, SUCCESS_AUTO_CLOSE_MS);
      return () => {
        if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
      };
    }
  }, [status, onContinue]);

  if (status === "creating") {
    return (
      <div className="flex flex-col items-center gap-2 py-6">
        <Loader2
          size={24}
          className="animate-spin text-[var(--tc-accent,#3b82f6)]"
        />
        <p className="text-[13px] text-[var(--tc-secondary,rgba(255,255,255,0.7))]">
          正在生成二维码…
        </p>
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div className="flex flex-col items-center gap-2 py-4">
        {/* 呼吸动画点 */}
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[var(--tc-accent,#3b82f6)] animate-breathe" />
          <span
            className="w-2 h-2 rounded-full bg-[var(--tc-accent,#3b82f6)] animate-breathe"
            style={{ animationDelay: "0.5s" }}
          />
          <span
            className="w-2 h-2 rounded-full bg-[var(--tc-accent,#3b82f6)] animate-breathe"
            style={{ animationDelay: "1s" }}
          />
        </span>
        <p className="text-[13px] text-[var(--tc-muted,rgba(255,255,255,0.4))]">
          等待支付结果…
        </p>
        <style>{`
          @keyframes breathe {
            0%, 100% { opacity: 0.3; transform: scale(0.9); }
            50% { opacity: 1; transform: scale(1.1); }
          }
          .animate-breathe {
            animation: breathe 1.8s ease-in-out infinite;
          }
        `}</style>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle size={48} className="text-[var(--tc-success,#22c55e)]" />
        <div>
          <p className="text-[16px] font-semibold text-[var(--tc-primary,#ffffff)]">
            充值成功
          </p>
          {order && (
            <p className="text-[13px] text-[var(--tc-secondary,rgba(255,255,255,0.7))] mt-1">
              获得 {order.points} 积分
            </p>
          )}
          {newBalance != null && (
            <p className="text-[12px] text-[var(--tc-muted,rgba(255,255,255,0.4))] mt-0.5">
              当前余额 {newBalance}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onContinue}
          className="inline-flex items-center px-5 py-2 rounded-lg text-[13px] font-medium bg-[var(--tc-accent,#3b82f6)] text-[var(--tc-on-accent,#ffffff)] hover:opacity-90 transition-opacity mt-2"
        >
          继续
        </button>
      </div>
    );
  }

  // failed
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <AlertCircle size={40} className="text-[var(--tc-destructive,#ef4444)]" />
      <div>
        <p className="text-[14px] text-[var(--tc-primary,#ffffff)]">
          {error ?? "支付失败"}
        </p>
        <p className="text-[12px] text-[var(--tc-muted,rgba(255,255,255,0.4))] mt-1">
          请重试或选择其他支付方式
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center px-4 py-2 rounded-lg text-[13px] font-medium bg-[var(--tc-accent,#3b82f6)] text-[var(--tc-on-accent,#ffffff)] hover:opacity-90 transition-opacity"
      >
        重试
      </button>
    </div>
  );
}
