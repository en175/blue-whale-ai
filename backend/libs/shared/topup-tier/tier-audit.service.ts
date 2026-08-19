import { Injectable } from "@nestjs/common";
import type { TopupTierView } from "@blue-whale/persistence";
import { OperationLogService } from "@lib/shared/operation-log/operation-log.service.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";

const OPERATOR = "admin";

function tierStatusLabel(s: string): string {
  return s === "active" ? "启用" : "停用";
}

function fmtAuditTime(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace("T", " ") : "无";
}

function fmtDiscount(discount: number): string {
  if (discount >= 1) return "无折扣";
  const zhe = `${discount * 10}`.replace(/\.0$/, "");
  return `${zhe}折`;
}

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

@Injectable()
export class TierAuditService {
  constructor(private readonly operationLog: OperationLogService) {}

  private async writeLog(entry: {
    action: string;
    target: string;
    detail: string;
  }): Promise<void> {
    try {
      await this.operationLog.create({
        category: "tier",
        operator: OPERATOR,
        ...entry,
      });
    } catch (e) {
      logger.error(
        `[topup-tiers] 审计写入失败（不影响档位主流程）: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async logCreate(tier: TopupTierView): Promise<void> {
    const parts = [
      `${tier.amount}积分`,
      `原价¥${tier.originalPrice}`,
      fmtDiscount(tier.discount),
      `实付¥${tier.price}`,
      `状态${tierStatusLabel(tier.status)}`,
    ];
    if (tier.startTime) parts.push(`生效${fmtAuditTime(tier.startTime)}`);
    if (tier.endTime) parts.push(`失效${fmtAuditTime(tier.endTime)}`);
    await this.writeLog({
      action: "创建",
      target: tier.id,
      detail: `新建档位：${parts.join("，")}`,
    });
  }

  async logUpdate(before: TopupTierView, after: TopupTierView): Promise<void> {
    await this.writeLog({
      action: "编辑",
      target: after.id,
      detail: describeTierChanges(before, after),
    });
  }

  async logDelete(before: TopupTierView): Promise<void> {
    await this.writeLog({
      action: "删除",
      target: before.id,
      detail: `删除档位：${before.amount}积分，原价¥${before.originalPrice}，实付¥${before.price}`,
    });
  }
}
