import type { TopupTierView } from "@blue-whale/persistence";

import { createOperationLogDeps } from "@/lib/operation-log/deps";

/**
 * 档位操作审计（服务端写入）。
 *
 * 审计落点原则：topup-tiers 的 POST/PUT/DELETE 路由是变更的事实源
 * （before/after 快照服务端都持有），故审计在服务端写，不由浏览器端补记——
 * 浏览器写入既会被客户端静默屏蔽（真实变更无痕），也可被伪造。
 * orders/users/pricing 等尚无后端路由的纯前端模块暂仍走客户端 writeAuditLog。
 *
 * best-effort：审计失败只记录、不阻断档位主流程（与折扣同步同策略）。
 */

// TODO(admin 鉴权落地)：operator 换成真实登录身份（见 IK51OP 后续工单）。
const OPERATOR = "admin";

function tierStatusLabel(s: string): string {
  return s === "active" ? "启用" : "停用";
}

/** 与表单展示一致：直接取 ISO 的 UTC 墙钟（YYYY-MM-DD HH:mm），不转本地时区；空 → "无"。 */
function fmtAuditTime(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace("T", " ") : "无";
}

/** 折扣展示：0.85 → "8.5折"；1 → "无折扣"。 */
function fmtDiscount(discount: number): string {
  if (discount >= 1) return "无折扣";
  const zhe = `${discount * 10}`.replace(/\.0$/, "");
  return `${zhe}折`;
}

/** 编辑档位：对比改前后视图，列出具体变更字段（旧→新）。 */
export function describeTierChanges(
  before: TopupTierView,
  after: TopupTierView,
): string {
  const changes: string[] = [];
  if (before.amount !== after.amount)
    changes.push(`积分数：${before.amount}→${after.amount}`);
  if (before.originalPrice !== after.originalPrice)
    changes.push(`原价：¥${before.originalPrice}→¥${after.originalPrice}`);
  if (before.discount !== after.discount)
    changes.push(`折扣：${before.discount}→${after.discount}`);
  if (before.status !== after.status)
    changes.push(
      `状态：${tierStatusLabel(before.status)}→${tierStatusLabel(after.status)}`,
    );
  if (before.isRecommended !== after.isRecommended)
    changes.push(
      `推荐：${before.isRecommended ? "是" : "否"}→${after.isRecommended ? "是" : "否"}`,
    );
  if ((before.startTime ?? "") !== (after.startTime ?? ""))
    changes.push(
      `生效时间：${fmtAuditTime(before.startTime)}→${fmtAuditTime(after.startTime)}`,
    );
  if ((before.endTime ?? "") !== (after.endTime ?? ""))
    changes.push(
      `失效时间：${fmtAuditTime(before.endTime)}→${fmtAuditTime(after.endTime)}`,
    );
  return changes.length > 0 ? changes.join("；") : "保存档位（无字段变更）";
}

async function writeLog(entry: {
  action: string;
  target: string;
  detail: string;
}): Promise<void> {
  try {
    const { db } = createOperationLogDeps();
    await db.create({ category: "tier", operator: OPERATOR, ...entry });
  } catch (e) {
    console.error("[topup-tiers] 审计写入失败（不影响档位主流程）", e);
  }
}

export async function logTierCreate(tier: TopupTierView): Promise<void> {
  const parts = [
    `${tier.amount}积分`,
    `原价¥${tier.originalPrice}`,
    fmtDiscount(tier.discount),
    `实付¥${tier.price}`,
    `状态${tierStatusLabel(tier.status)}`,
  ];
  if (tier.startTime) parts.push(`生效${fmtAuditTime(tier.startTime)}`);
  if (tier.endTime) parts.push(`失效${fmtAuditTime(tier.endTime)}`);
  await writeLog({
    action: "创建",
    target: tier.id,
    detail: `新建档位：${parts.join("，")}`,
  });
}

export async function logTierUpdate(
  before: TopupTierView,
  after: TopupTierView,
): Promise<void> {
  await writeLog({
    action: "编辑",
    target: after.id,
    detail: describeTierChanges(before, after),
  });
}

export async function logTierDelete(before: TopupTierView): Promise<void> {
  await writeLog({
    action: "删除",
    target: before.id,
    detail: `删除档位：${before.amount}积分，原价¥${before.originalPrice}，实付¥${before.price}`,
  });
}
