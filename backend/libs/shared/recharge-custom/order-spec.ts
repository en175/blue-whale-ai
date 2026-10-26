import { NewApiError } from "@lib/core";
import type { RechargeCustomConfigView } from "@lib/shared/persistence/index.js";
import {
  canPurchaseCustom,
  customDeniedHint,
  customPriceFen,
  parseCustomCredits,
} from "./constants.js";

export interface CustomOrderPlan {
  tierId: null;
  amountFen: number;
  credits: number;
  creditsPerYuan: number;
  productType: "custom";
  productName: string;
  configVersion: number;
  creditsValidMonths: number;
  permissionResult: string;
  bonusCredits: number;
  subject: string;
  body: string;
}

export function buildCustomOrderPlan(
  config: RechargeCustomConfigView,
  userId: number,
  rawCredits: unknown,
): CustomOrderPlan {
  if (!config.enabled) {
    throw new NewApiError("自定义充值暂未开放", 400);
  }
  const allowed = canPurchaseCustom(config, userId);
  if (!allowed) {
    throw new NewApiError(customDeniedHint(config), 403);
  }

  const credits = parseCustomCredits(rawCredits);
  if (credits === null) {
    throw new NewApiError("积分数量须为 1 以上的整数", 400);
  }
  if (credits < config.minCredits || credits > config.maxCredits) {
    throw new NewApiError(
      `积分数量须在 ${config.minCredits} ~ ${config.maxCredits} 之间`,
      400,
    );
  }
  if ((credits - config.minCredits) % config.stepCredits !== 0) {
    throw new NewApiError(
      `积分数量须为 ${config.stepCredits} 的整数倍（从 ${config.minCredits} 起算）`,
      400,
    );
  }

  const amountFen = customPriceFen(credits, config.creditsPerYuan);
  if (amountFen <= 0) {
    throw new NewApiError("该积分数折算出的金额不合法，请联系客服", 500);
  }

  return {
    tierId: null,
    amountFen,
    credits,
    creditsPerYuan: config.creditsPerYuan,
    productType: "custom",
    productName: "自定义充值",
    configVersion: config.version,
    creditsValidMonths: config.creditsValidMonths,
    permissionResult: allowed ? "allowed" : "denied",
    bonusCredits: 0,
    subject: "自定义充值",
    body: `自定义充值 ${credits} 积分`,
  };
}
