"use client";
/**
 * PaymentPanel — 右栏支付面板
 *
 * 组合支付方式 Tab、确认按钮、QR 码、倒计时、轮询状态、成功/失败展示。
 * 通过 useRechargeFlow 的 flow state 驱动 UI。
 *
 * States:
 *   IDLE / CONFIRMING — 显示档位摘要 + 支付方式 + 确认按钮
 *   CREATING_ORDER    — loading
 *   QR_READY          — 二维码 + 轮询
 *   PAYMENT_SUCCESS   — 成功
 *   PAYMENT_FAILED    — 失败
 *   EXPIRED           — 过期覆盖层
 */
import { Smartphone } from "lucide-react";
import { QRCode } from "./QRCode";
import { PaymentStatus } from "./PaymentStatus";
import { usePolling } from "./usePolling";
import { getOrderStatus } from "@/lib/api/recharge";
import { POLL_INTERVAL_DEFAULT } from "./constants";
import type { PaymentMethod } from "./types";
import type { FlowStateData } from "./useRechargeFlow";

// re-export for consumers
export type { FlowStateData };

interface PaymentPanelProps {
  flow: FlowStateData;
  onPaymentMethodChange: (method: PaymentMethod) => void;
  onConfirmOrder: () => void;
  onPollSuccess: (data: {
    status: string;
    credits_after: number | null;
  }) => void;
  onRegenerateQR: () => void;
  onClose: () => void;
  onRetry: () => void;
}

const PAYMENT_METHODS: { key: PaymentMethod; label: string }[] = [
  { key: "wechat", label: "微信支付" },
  { key: "alipay", label: "支付宝" },
];

export function PaymentPanel({
  flow,
  onPaymentMethodChange,
  onConfirmOrder,
  onPollSuccess,
  onRegenerateQR,
  onClose,
  onRetry,
}: PaymentPanelProps) {
  const { state, selectedTier, paymentMethod, order, newBalance, error } = flow;

  // 轮询：仅在 QR_READY 时启用
  const pollEnabled = state === "QR_READY" && !!order;
  const { degraded } = usePolling({
    fetcher: () =>
      getOrderStatus(order!.tradeNo).then((res) => ({
        status: res.status,
        credits_after: res.credits_after,
      })),
    interval: POLL_INTERVAL_DEFAULT,
    enabled: pollEnabled,
    onSuccess: onPollSuccess,
  });

  // 未选档位
  if (!selectedTier) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] rounded-xl border border-[var(--tc-border-subtle,rgba(255,255,255,0.08))] bg-[var(--tc-bg-surface,#1a1a1a)]">
        <div className="flex flex-col items-center gap-2 text-center px-6">
          <span className="text-[32px]">💳</span>
          <p className="text-[14px] text-[var(--tc-secondary,rgba(255,255,255,0.7))]">
            请选择充值套餐
          </p>
          <p className="text-[12px] text-[var(--tc-muted,rgba(255,255,255,0.4))]">
            选择左侧档位后确认支付
          </p>
        </div>
      </div>
    );
  }

  // 成功
  if (state === "PAYMENT_SUCCESS") {
    return (
      <div className="flex flex-col rounded-xl border border-[var(--tc-border-subtle,rgba(255,255,255,0.08))] bg-[var(--tc-bg-surface,#1a1a1a)] p-6">
        <PaymentStatus
          status="success"
          order={order}
          newBalance={newBalance}
          error={null}
          onContinue={onClose}
          onRetry={onRetry}
        />
      </div>
    );
  }

  // 失败
  if (state === "PAYMENT_FAILED") {
    return (
      <div className="flex flex-col rounded-xl border border-[var(--tc-border-subtle,rgba(255,255,255,0.08))] bg-[var(--tc-bg-surface,#1a1a1a)] p-6">
        <PaymentStatus
          status="failed"
          order={order}
          newBalance={null}
          error={error}
          onContinue={onClose}
          onRetry={onRetry}
        />
      </div>
    );
  }

  const isCreating = state === "CREATING_ORDER";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[var(--tc-border-subtle,rgba(255,255,255,0.08))] bg-[var(--tc-bg-surface,#1a1a1a)] p-6 min-h-[300px]">
      {/* 支付方式 Tab */}
      <div className="flex gap-1 p-1 rounded-lg bg-[var(--tc-bg-elevated,#2a2a2a)]">
        {PAYMENT_METHODS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => onPaymentMethodChange(key)}
            disabled={isCreating}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-md text-[13px] transition-all ${
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

      {/* 内容区 */}
      <div className="flex flex-col items-center gap-4 flex-1 justify-center">
        {/* 确认下单 */}
        {(state === "IDLE" || state === "CONFIRMING") && (
          <>
            {/* 档位摘要 */}
            <div className="w-full p-4 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              <p className="text-[12px] text-[var(--tc-muted,rgba(255,255,255,0.4))]">
                充值套餐
              </p>
              <p className="text-[16px] font-medium text-[var(--tc-primary,#ffffff)] mt-0.5">
                {selectedTier.amount.toLocaleString()} 积分
                {selectedTier.bonus > 0 && (
                  <span className="text-[12px] text-[var(--tc-accent,#3b82f6)] ml-1">
                    +{selectedTier.bonus} 赠送
                  </span>
                )}
              </p>
              <p className="text-[22px] font-semibold text-[var(--tc-primary,#ffffff)] mt-2">
                ¥{selectedTier.price}
              </p>
            </div>

            <button
              type="button"
              onClick={onConfirmOrder}
              className="w-full inline-flex items-center justify-center h-10 px-6 rounded-lg text-[14px] font-medium bg-[var(--tc-accent,#3b82f6)] text-[var(--tc-on-accent,#ffffff)] hover:opacity-90 transition-opacity"
            >
              确认支付 ¥{selectedTier.price}
            </button>
          </>
        )}

        {/* 创建中 */}
        {isCreating && (
          <PaymentStatus
            status="creating"
            order={null}
            newBalance={null}
            error={null}
            onContinue={onClose}
            onRetry={onRetry}
          />
        )}

        {/* QR 就绪 */}
        {state === "QR_READY" && order && (
          <>
            <QRCode
              qrCodeUrl={order.qrCodeUrl}
              expireTime={order.expireTime}
              onRegenerate={onRegenerateQR}
            />

            {/* 支付信息 */}
            <div className="text-center">
              <p className="text-[12px] text-[var(--tc-muted,rgba(255,255,255,0.4))]">
                请用{paymentMethod === "wechat" ? "微信" : "支付宝"}扫码支付
              </p>
              <p className="text-[22px] font-semibold text-[var(--tc-primary,#ffffff)] mt-1">
                ¥{order.amount}
              </p>
              <p className="text-[12px] text-[var(--tc-secondary,rgba(255,255,255,0.7))]">
                获得 {order.points} 积分
              </p>
            </div>

            <PaymentStatus
              status="pending"
              order={order}
              newBalance={null}
              error={null}
              onContinue={onClose}
              onRetry={onRetry}
            />

            {/* 轮询降级提示 */}
            {degraded && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--tc-warning,#f59e0b)]/10 border border-[var(--tc-warning,#f59e0b)]/20 text-[12px] text-[var(--tc-secondary,rgba(255,255,255,0.7))]">
                <span className="mt-0.5 shrink-0 text-[var(--tc-warning,#f59e0b)]">
                  ⚠
                </span>
                <span>支付状态获取失败，可稍后在账户中心查看订单记录</span>
              </div>
            )}
          </>
        )}

        {/* 过期 */}
        {state === "EXPIRED" && (
          <QRCode
            qrCodeUrl={order?.qrCodeUrl ?? ""}
            expireTime={order?.expireTime ?? new Date().toISOString()}
            onRegenerate={onRegenerateQR}
          />
        )}
      </div>
    </div>
  );
}
