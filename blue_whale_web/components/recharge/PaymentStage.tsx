"use client";
/**
 * PaymentStage — 支付过程面板（三联布局右栏；移动端纵向堆叠）
 *
 * 承载下单后的全部状态展示：创建中 / 二维码 / 成功 / 失败 / 过期。
 * 轮询在此组件内运行（仅 QR_READY 时启用）。
 *
 * States:
 *   CREATING_ORDER  — loading
 *   QR_READY        — 二维码 + 轮询
 *   PAYMENT_SUCCESS — 成功
 *   PAYMENT_FAILED  — 失败
 *   EXPIRED         — 过期覆盖层
 */
import { QRCode } from "./QRCode";
import { PaymentStatus } from "./PaymentStatus";
import { usePolling } from "./usePolling";
import { getOrderStatus } from "@/lib/api/recharge";
import { POLL_INTERVAL_DEFAULT } from "./constants";
import type { FlowStateData } from "./useRechargeFlow";

interface PaymentStageProps {
  flow: FlowStateData;
  onPollSuccess: (data: {
    status: string;
    credits_after: number | null;
  }) => void;
  onRegenerateQR: () => void;
  onClose: () => void;
  onRetry: () => void;
}

export function PaymentStage({
  flow,
  onPollSuccess,
  onRegenerateQR,
  onClose,
  onRetry,
}: PaymentStageProps) {
  const { state, paymentMethod, order, newBalance, error } = flow;

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

  const isCreating = state === "CREATING_ORDER";

  // 成功
  if (state === "PAYMENT_SUCCESS") {
    return (
      <div className="flex flex-col rounded-xl border border-[var(--tc-border-subtle,rgba(255,255,255,0.08))] bg-[var(--tc-bg-surface,#1a1a1a)] p-6 h-full justify-center animate-in fade-in slide-in-from-right-2 duration-200 motion-reduce:animate-none">
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
      <div className="flex flex-col rounded-xl border border-[var(--tc-border-subtle,rgba(255,255,255,0.08))] bg-[var(--tc-bg-surface,#1a1a1a)] p-6 h-full justify-center animate-in fade-in slide-in-from-right-2 duration-200 motion-reduce:animate-none">
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

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-[var(--tc-border-subtle,rgba(255,255,255,0.08))] bg-[var(--tc-bg-surface,#1a1a1a)] p-6 h-full justify-center animate-in fade-in slide-in-from-right-2 duration-200 motion-reduce:animate-none">
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
  );
}
