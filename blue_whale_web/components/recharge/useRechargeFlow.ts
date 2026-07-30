"use client";
/**
 * useRechargeFlow — 充值流程状态机 hook
 *
 * 管理从选档位到支付成功的完整流程。内部用 useReducer 驱动 FSM。
 *
 * Transitions:
 *   IDLE → CONFIRMING（选档位）→ CREATING_ORDER（确认）→ QR_READY
 *   CREATING_ORDER → PAYMENT_FAILED
 *   QR_READY → PAYMENT_SUCCESS | EXPIRED | CANCELLED
 *   EXPIRED → CONFIRMING（重新选择）
 */
import { useReducer, useCallback, useRef, useEffect } from "react";
import { createRechargeOrder, cancelRechargeOrder } from "@/lib/api/recharge";
import type {
  PaymentMethod,
  RechargeOrder,
  FlowState,
  RechargeTier,
} from "./types";

// ---- state ----

export interface FlowStateData {
  state: FlowState;
  selectedTier: RechargeTier | null;
  paymentMethod: PaymentMethod;
  order: RechargeOrder | null;
  newBalance: number | null;
  error: string | null;
}

const initialState: FlowStateData = {
  state: "IDLE",
  selectedTier: null,
  paymentMethod: "wechat",
  order: null,
  newBalance: null,
  error: null,
};

// ---- actions ----

type Action =
  | { type: "SELECT_TIER"; tier: RechargeTier }
  | { type: "SET_PAYMENT_METHOD"; method: PaymentMethod }
  | { type: "CONFIRM_ORDER" }
  | { type: "CREATING_ORDER" }
  | { type: "ORDER_CREATED"; order: RechargeOrder }
  | { type: "ORDER_FAILED"; error: string }
  | { type: "POLL_PAID"; newBalance: number }
  | { type: "EXPIRE" }
  | { type: "CANCEL" }
  | { type: "REGENERATE" }
  | { type: "RESET" };

// ---- reducer ----

function reducer(state: FlowStateData, action: Action): FlowStateData {
  switch (action.type) {
    case "SELECT_TIER":
      return {
        ...state,
        selectedTier: action.tier,
        state: "CONFIRMING",
        order: null,
        error: null,
      };

    case "SET_PAYMENT_METHOD":
      return { ...state, paymentMethod: action.method };

    case "CONFIRM_ORDER":
      return { ...state, state: "CREATING_ORDER", error: null };

    case "CREATING_ORDER":
      return { ...state, state: "CREATING_ORDER", error: null };

    case "ORDER_CREATED":
      return { ...state, state: "QR_READY", order: action.order, error: null };

    case "ORDER_FAILED":
      return { ...state, state: "PAYMENT_FAILED", error: action.error };

    case "POLL_PAID":
      return {
        ...state,
        state: "PAYMENT_SUCCESS",
        newBalance: action.newBalance,
      };

    case "EXPIRE":
      return { ...state, state: "EXPIRED" };

    case "CANCEL":
      return { ...state, state: "CANCELLED" };

    case "REGENERATE":
      return { ...state, state: "CONFIRMING", error: null };

    case "RESET":
      return initialState;

    default:
      return state;
  }
}

// ---- helper: create order from tier + method ----

async function createOrder(
  tier: RechargeTier,
  method: PaymentMethod,
): Promise<RechargeOrder> {
  const res = await createRechargeOrder({
    tier_id: tier.id,
    payment_method: method,
  });
  return {
    tradeNo: res.trade_no,
    qrCodeUrl: res.qr_code_url,
    expireTime: res.expire_time,
    amount: res.amount,
    points: res.points,
    paymentMethod: method,
  };
}

// ---- hook ----

export function useRechargeFlow() {
  const [flow, dispatch] = useReducer(reducer, initialState);
  const flowRef = useRef(flow);
  useEffect(() => {
    flowRef.current = flow;
  });

  /** 选择档位 → 进入确认状态 */
  const selectTier = useCallback((tier: RechargeTier) => {
    dispatch({ type: "SELECT_TIER", tier });
  }, []);

  /** 切换支付方式。已有订单时取消旧订单并回到确认状态。 */
  const setPaymentMethod = useCallback((method: PaymentMethod) => {
    const cur = flowRef.current;
    if (cur.order?.tradeNo) {
      cancelRechargeOrder(cur.order.tradeNo).catch(() => {});
      dispatch({ type: "SELECT_TIER", tier: cur.selectedTier! });
    }
    dispatch({ type: "SET_PAYMENT_METHOD", method });
  }, []);

  /** 确认下单 */
  const confirmOrder = useCallback(() => {
    dispatch({ type: "CONFIRM_ORDER" });
  }, []);

  // 当进入 CREATING_ORDER 状态时，自动调用 createOrder API
  useEffect(() => {
    if (flow.state !== "CREATING_ORDER") return;
    if (!flow.selectedTier) return;

    let cancelled = false;

    createOrder(flow.selectedTier, flow.paymentMethod)
      .then((order) => {
        if (!cancelled) dispatch({ type: "ORDER_CREATED", order });
      })
      .catch((e) => {
        if (!cancelled)
          dispatch({
            type: "ORDER_FAILED",
            error: e instanceof Error ? e.message : "创建订单失败",
          });
      });

    return () => {
      cancelled = true;
    };
  }, [flow.state, flow.selectedTier, flow.paymentMethod]);

  /** 轮询成功回调 */
  const onPollSuccess = useCallback(
    (data: { status: string; credits_after: number | null }) => {
      if (data.status === "paid") {
        dispatch({
          type: "POLL_PAID",
          newBalance: data.credits_after ?? 0,
        });
      } else if (data.status === "expired") {
        dispatch({ type: "EXPIRE" });
      }
    },
    [],
  );

  /** 取消订单（关闭弹窗时调用） */
  const cancelOrder = useCallback(async () => {
    const order = flowRef.current.order;
    if (order?.tradeNo) {
      cancelRechargeOrder(order.tradeNo).catch(() => {
        /* 静默 */
      });
    }
    dispatch({ type: "CANCEL" });
  }, []);

  /** 重新生成 → 回到确认状态 */
  const regenerateQR = useCallback(() => {
    const order = flowRef.current.order;
    if (order?.tradeNo) {
      cancelRechargeOrder(order.tradeNo).catch(() => {});
    }
    dispatch({ type: "REGENERATE" });
  }, []);

  /** 重置 */
  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  return {
    flow,
    selectTier,
    setPaymentMethod,
    confirmOrder,
    onPollSuccess,
    cancelOrder,
    regenerateQR,
    reset,
  };
}
