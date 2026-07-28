"use client";
/**
 * RechargeModal — 积分充值弹窗（三合一支付弹窗）
 *
 * 左栏：档位网格（TierGrid）
 * 右栏：支付面板（PaymentPanel）
 *
 * Props:
 * - onClose: 关闭回调
 * - onRecharged?: 充值成功回调，携带新余额
 * - shortfall?: 积分不足上下文（入口 3），显示差额横幅
 */
import { useCallback, useMemo, useState } from "react";
import { ModalShell } from "@/components/auth/ModalShell";
import { useAuth } from "@/components/auth/AuthContext";
import { TierGrid } from "./TierGrid";
import { PaymentPanel } from "./PaymentPanel";
import { BottomSheet } from "./BottomSheet";
import { RechargeAgreementModal } from "./RechargeAgreementModal";
import { useRechargeFlow } from "./useRechargeFlow";
import { useResponsive } from "./useResponsive";
import { DESKTOP_MODAL_WIDTH } from "./constants";
import type { RechargeTier, Shortfall } from "./types";

interface RechargeModalProps {
  onClose: () => void;
  onRecharged?: (newBalance: number) => void;
  shortfall?: Shortfall;
}

export function RechargeModal({
  onClose,
  onRecharged,
  shortfall,
}: RechargeModalProps) {
  const { updateLocalUser } = useAuth();
  const { isMobile } = useResponsive();
  const [agreementOpen, setAgreementOpen] = useState(false);
  const {
    flow,
    selectTier,
    setPaymentMethod,
    onPollSuccess: rawOnPollSuccess,
    cancelOrder,
    regenerateQR,
    reset,
  } = useRechargeFlow();

  // 包一层 onPollSuccess，支付成功时刷新余额
  const onPollSuccess = useCallback(
    (data: { status: string; credits_after: number | null }) => {
      rawOnPollSuccess(data);
      if (data.status === "paid" && data.credits_after != null) {
        updateLocalUser({ credits: data.credits_after });
        onRecharged?.(data.credits_after);
      }
    },
    [rawOnPollSuccess, updateLocalUser, onRecharged],
  );

  // 关闭：取消订单 + 重置
  const handleClose = useCallback(() => {
    if (flow.state === "QR_READY" || flow.state === "CREATING_ORDER") {
      cancelOrder();
    }
    reset();
    onClose();
  }, [flow.state, cancelOrder, reset, onClose]);

  const handleRetry = useCallback(() => {
    regenerateQR();
  }, [regenerateQR]);

  const handleSelectTier = useCallback(
    (tier: RechargeTier) => {
      selectTier(tier);
    },
    [selectTier],
  );

  // 不足拦截：自动高亮首个覆盖差额的档位
  const autoSelectPredicate = useMemo(
    () =>
      shortfall
        ? (tier: RechargeTier) => tier.amount >= shortfall.missing
        : undefined,
    [shortfall],
  );

  const inner = (
    <>
      <h2 className="text-[20px] font-semibold leading-tight mb-5 text-[var(--tc-primary,#ffffff)]">
        积分充值
      </h2>

      {/* shortfall 横幅 */}
      {shortfall && (
        <div className="mb-4 p-3 rounded-lg bg-[var(--tc-destructive,#ef4444)]/10 border border-[var(--tc-destructive,#ef4444)]/20 text-[13px] text-[var(--tc-secondary,rgba(255,255,255,0.7))]">
          本次生成需{" "}
          <span className="text-[var(--tc-primary,#ffffff)] font-medium">
            {shortfall.need}
          </span>{" "}
          积分，当前余额{" "}
          <span className="text-[var(--tc-primary,#ffffff)] font-medium">
            {shortfall.balance}
          </span>
          ，还差{" "}
          <span className="text-[var(--tc-destructive,#ef4444)] font-medium">
            {shortfall.missing}
          </span>{" "}
          积分
        </div>
      )}

      {/* 档位 + 支付：桌面双栏，移动端纵向堆叠 */}
      <div
        className={
          isMobile
            ? "flex flex-col gap-4"
            : "flex gap-6"
        }
      >
        <div className="flex-1 min-w-0">
          <TierGrid
            selectedTierId={flow.selectedTier?.id ?? null}
            onSelectTier={handleSelectTier}
            autoSelectPredicate={autoSelectPredicate}
          />
        </div>
        <div className="flex-1 min-w-0">
          <PaymentPanel
            flow={flow}
            onPaymentMethodChange={setPaymentMethod}
            onPollSuccess={onPollSuccess}
            onRegenerateQR={regenerateQR}
            onClose={handleClose}
            onRetry={handleRetry}
          />
        </div>
      </div>

      {/* 协议链接 */}
      <p className="mt-4 text-center text-[12px] text-[var(--tc-muted,rgba(255,255,255,0.4))]">
        充值即视为同意
        <button
          type="button"
          onClick={() => setAgreementOpen(true)}
          className="text-[var(--tc-accent,#3b82f6)] hover:opacity-80 underline-offset-4 hover:underline transition-colors ml-1"
        >
          《充值协议》
        </button>
      </p>
    </>

  );

  // 移动端用 BottomSheet，桌面端用 ModalShell
  return (
    <>
      {isMobile ? (
        <BottomSheet
          ariaLabel="积分充值"
          onClose={handleClose}
          closeOnEscape={!agreementOpen}
        >
          {inner}
        </BottomSheet>
      ) : (
        <ModalShell
          ariaLabel="积分充值"
          onClose={handleClose}
          width={DESKTOP_MODAL_WIDTH}
          closeOnEscape={!agreementOpen}
        >
          {inner}
        </ModalShell>
      )}

      {/* 协议二级弹窗 */}
      {agreementOpen && (
        <RechargeAgreementModal onClose={() => setAgreementOpen(false)} />
      )}
    </>
  );
}
