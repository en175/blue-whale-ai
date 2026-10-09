export const LOT_SOURCE_TEXT: Record<string, string> = {
  purchased: "充值到账",
  bonus: "充值赠送",
  gift: "赠送",
  compensation: "补偿",
  daily: "每日赠送",
  invite: "邀请奖励",
  register: "注册赠送",
  redeem: "兑换",
  subscription: "订阅",
};

export function lotSourceText(source: string): string {
  return LOT_SOURCE_TEXT[source] ?? source;
}

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

export function dateOnly(value: string): string {
  return DATE_PREFIX.exec(value)?.[0] ?? value;
}

export const EXPIRE_TYPE = "expire";

const SPEC_KEYS = ["resolution", "size", "duration", "aspect_ratio"] as const;

export function formatSpecs(specs: Record<string, string> | null): string {
  if (specs === null) return "";
  const parts: string[] = [];
  for (const key of SPEC_KEYS) {
    const raw = specs[key];
    if (raw === undefined || raw === "") continue;
    if (key === "duration") {
      if (Number(raw) <= 0) continue;
      parts.push(`${raw}s`);
    } else {
      parts.push(raw);
    }
  }
  return parts.join(" · ");
}

export interface ConsumptionDetailRow {
  type: string;
  title: string;
  prompt: string | null;
  specs: Record<string, string> | null;
  task_type: string | null;
  lot_source: string | null;
  lot_created_at: string | null;
}

export function consumeDetail(row: ConsumptionDetailRow): string {
  if (row.type === EXPIRE_TYPE) {
    if (row.lot_source === null || row.lot_created_at === null) return "—";
    return `${dateOnly(row.lot_created_at)} ${lotSourceText(row.lot_source)}批次`;
  }
  const parts = [formatSpecs(row.specs), row.prompt ?? ""].filter((part) => part !== "");
  if (parts.length > 0) return parts.join(" · ");
  return row.task_type === null ? row.title : "—";
}
