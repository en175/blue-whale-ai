"use client";
/**
 * PaymentPanel — 底部支付操作条（三联布局中栏底部）
 *
 * 职责收敛：仅「未选提示」与「套餐摘要 + 支付方式 Tab + 确认支付按钮」。
 * 下单后的状态展示（创建中/二维码/成功/失败/过期）由 PaymentStage 承载
 * （桌面端右栏，移动端纵向堆叠）。
 */
import { Smartphone } from "lucide-react";
import type { PaymentMethod } from "./types";
import type { FlowStateData } from "./useRechargeFlow";

// re-export for consumers
export type { FlowStateData };

interface PaymentPanelProps {
  flow: FlowStateData;
  onPaymentMethodChange: (method: PaymentMethod) => void;
  onConfirmOrder: () => void;
}

const PAYMENT_METHODS: { key: PaymentMethod; label: string }[] = [
  { key: "wechat", label: "微信支付" },
  { key: "alipay", label: "支付宝" },
];

export function PaymentPanel({
  flow,
  onPaymentMethodChange,
  onConfirmOrder,
}: PaymentPanelProps) {
  const { state, selectedTier, paymentMethod } = flow;

  // 下单后操作条保持显示（按钮变禁用态），避免高度突变
  const paymentStarted =
    state === "CREATING_ORDER" ||
    state === "QR_READY" ||
    state === "PAYMENT_SUCCESS" ||
    state === "PAYMENT_FAILED" ||
    state === "EXPIRED";

  // 未选套餐：紧凑提示条
  if (!selectedTier) {
    return (
      <div className="flex items-center justify-center gap-2 py-4 rounded-xl border border-dashed border-[var(--tc-border-subtle,rgba(255,255,255,0.08))] bg-[var(--tc-bg-surface,#1a1a1a)]">
        <span className="text-[20px]">💳</span>
        <p className="text-[13px] text-[var(--tc-secondary,rgba(255,255,255,0.7))]">
          请选择充值套餐
          <span className="ml-1 text-[12px] text-[var(--tc-muted,rgba(255,255,255,0.4))]">
            选择上方套餐后确认支付
          </span>
        </p>
      </div>
    );
  }

  // 确认下单：横向操作条（套餐摘要 + 支付方式 + 确认按钮）
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center rounded-xl border border-[var(--tc-border-subtle,rgba(255,255,255,0.08))] bg-[var(--tc-bg-surface,#1a1a1a)] p-4">
      {/* 套餐摘要 */}
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="text-[13px] text-[var(--tc-muted,rgba(255,255,255,0.4))] shrink-0">
          {selectedTier.name}
        </span>
        <span className="text-[15px] font-semibold text-[var(--tc-primary,#ffffff)] truncate">
          {selectedTier.amount.toLocaleString()} 积分
        </span>
        <span className="text-[16px] font-semibold text-[var(--tc-primary,#ffffff)]">
          ¥{selectedTier.price}
        </span>
        {selectedTier.discount < 1 && (
          <>
            <span className="text-[12px] text-[var(--tc-muted,rgba(255,255,255,0.4))] line-through">
              ¥{selectedTier.originalPrice}
            </span>
            <span className="text-[11px] font-medium text-[var(--tc-accent,#3b82f6)]">
              {Math.round(selectedTier.discount * 100) / 10}折
            </span>
          </>
        )}
      </div>

      {/* 支付方式 Tab */}
      <div className="flex gap-1 p-1 rounded-lg bg-[var(--tc-bg-elevated,#2a2a2a)] sm:ml-auto shrink-0">
        {PAYMENT_METHODS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => onPaymentMethodChange(key)}
            className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-md text-[13px] transition-all ${
              paymentMethod === key
                ? "bg-[var(--tc-bg-surface,#1a1a1a)] text-[var(--tc-primary,#ffffff)] shadow-sm"
                : "text-[var(--tc-tertiary,rgba(255,255,255,0.55))] hover:text-[var(--tc-secondary,rgba(255,255,255,0.7))]"
            }`}
          >
            <Smartphone size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* 确认支付（支付中变禁用态，高度不变） */}
      <button
        type="button"
        onClick={onConfirmOrder}
        disabled={paymentStarted}
        className={`inline-flex items-center justify-center h-10 px-8 rounded-lg text-[14px] font-medium transition-all shrink-0 ${
          paymentStarted
            ? "bg-[var(--tc-bg-elevated,#2a2a2a)] text-[var(--tc-muted,rgba(255,255,255,0.4))] cursor-not-allowed"
            : "bg-[var(--tc-accent,#3b82f6)] text-[var(--tc-on-accent,#ffffff)] hover:opacity-90"
        }`}
      >
        {paymentStarted ? "支付中…" : `确认支付 ¥${selectedTier.price}`}
      </button>
    </div>
  );
}
