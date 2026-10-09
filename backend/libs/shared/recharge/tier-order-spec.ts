import { NewApiError } from "@lib/core";
import type { TopupTierView } from "@lib/shared/persistence/index.js";
import {
  canPurchaseTier,
  displayTierName,
  tierDeniedHint,
} from "@lib/shared/topup-tier/constants.js";

export interface TierOrderPlan {
  tierId: number;
  amountFen: number;
  credits: number;
  creditsPerYuan: number;
  productType: "tier";
  productName: string;
  configVersion: number;
  firstPurchaseEligible: number;
  bonusCredits?: number;
  creditsValidMonths: number;
  permissionResult: string;
  subject: string;
  body: string;
}

export function buildTierOrderPlan(
  tier: TopupTierView,
  creditsPerYuan: number,
  userId: number,
  nowMs: number,
): TierOrderPlan {
  if (tier.status !== "active") {
    throw new NewApiError(tier.status === "draft" ? "该档位尚未上架" : "该档位已下架", 400);
  }
  if (tier.startTime && new Date(tier.startTime).getTime() > nowMs) {
    throw new NewApiError("该档位尚未生效", 400);
  }
  if (tier.endTime && new Date(tier.endTime).getTime() < nowMs) {
    throw new NewApiError("该档位已过期", 400);
  }

  const allowed = canPurchaseTier(tier, userId);
  if (!allowed) {
    throw new NewApiError(tierDeniedHint(tier), 403);
  }

  const credits = tier.baseCredits;
  const amountFen = Math.round(tier.price * 100);
  if (credits <= 0 || amountFen <= 0) {
    throw new NewApiError("该档位的金额或积分不合法，请联系客服", 500);
  }

  const tierId = Number(tier.id);
  if (!Number.isSafeInteger(tierId)) {
    throw new NewApiError("档位 ID 不合法", 500);
  }

  return {
    tierId,
    amountFen,
    credits,
    creditsPerYuan,
    productType: "tier",
    productName: displayTierName(tier.name, credits),
    configVersion: tier.version,
    firstPurchaseEligible: tier.firstPurchaseEligible ? 1 : 0,
    ...(tier.firstPurchaseEligible && tier.bonusCredits > 0
      ? { bonusCredits: tier.bonusCredits }
      : {}),
    creditsValidMonths: tier.creditsValidMonths,
    permissionResult: "allowed",
    subject: tier.name || "积分充值",
    body: tier.name || `积分充值 ${credits} 积分`,
  };
}
