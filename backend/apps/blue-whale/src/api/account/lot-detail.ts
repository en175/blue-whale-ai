import { lotSourceText } from "./consumption-detail.js";

const LOT_ROLE_TEXT: Record<string, string> = {
  purchased: "充值积分",
  bonus: "赠送积分",
};

export interface LotDetailInput {
  source: string;
  amount: number;
  remaining: number;
  productName: string | null;
}

export function lotDetailText(lot: LotDetailInput): string {
  const role = LOT_ROLE_TEXT[lot.source];
  const name = lot.productName ?? "";
  const head =
    name === "" || role === undefined
      ? `${lotSourceText(lot.source)} ${lot.amount} 积分`
      : `${name}，${role}：${lot.amount}`;
  return lot.remaining < lot.amount ? `${head} · 剩余 ${lot.remaining}` : head;
}
