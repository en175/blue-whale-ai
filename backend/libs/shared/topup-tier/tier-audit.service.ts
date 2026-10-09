import { Injectable } from "@nestjs/common";
import type { TopupTierView } from "@lib/shared/persistence/index.js";
import { OperationLogService } from "@lib/shared/operation-log/operation-log.service.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import {
  tierPermissionLabel,
  tierStatusLabel,
} from "@lib/shared/topup-tier/constants.js";

const OPERATOR = "admin";

function fmtAuditTime(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace("T", " ") : "无";
}

function fmtDiscount(discount: number): string {
  if (discount >= 1) return "无折扣";
  const zhe = `${discount * 10}`.replace(/\.0$/, "");
  return `${zhe}折`;
}

function fmtText(v: string): string {
  return v === "" ? "无" : v;
}

function fmtAllowlist(list: string[]): string {
  if (list.length === 0) return "无";
  if (list.length <= 5) return list.join(",");
  return `${list.slice(0, 5).join(",")}…等 ${list.length} 人`;
}

export function describeTierChanges(
  before: TopupTierView,
  after: TopupTierView,
): string {
  const changes: string[] = [];
  if (before.baseCredits !== after.baseCredits)
    changes.push(`基础积分：${before.baseCredits}→${after.baseCredits}`);
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
  if (before.description !== after.description)
    changes.push(
      `卡片说明：${fmtText(before.description)}→${fmtText(after.description)}`,
    );
  if (before.bonusCredits !== after.bonusCredits)
    changes.push(`赠送积分：${before.bonusCredits}→${after.bonusCredits}`);
  if (before.activityTag !== after.activityTag)
    changes.push(
      `活动标签：${fmtText(before.activityTag)}→${fmtText(after.activityTag)}`,
    );
  if (before.buttonText !== after.buttonText)
    changes.push(`按钮文案：${before.buttonText}→${after.buttonText}`);
  if (before.firstPurchaseEligible !== after.firstPurchaseEligible)
    changes.push(
      `参与首购：${before.firstPurchaseEligible ? "是" : "否"}→${after.firstPurchaseEligible ? "是" : "否"}`,
    );
  if (before.creditsValidMonths !== after.creditsValidMonths)
    changes.push(
      `积分有效期：${before.creditsValidMonths}个月→${after.creditsValidMonths}个月`,
    );
  if (before.permission !== after.permission)
    changes.push(
      `购买权限：${tierPermissionLabel(before.permission)}→${tierPermissionLabel(after.permission)}`,
    );
  if (
    before.permissionAllowlist.join(",") !== after.permissionAllowlist.join(",")
  )
    changes.push(
      `权限白名单：${fmtAllowlist(before.permissionAllowlist)}→${fmtAllowlist(after.permissionAllowlist)}`,
    );
  if (before.permissionDeniedHint !== after.permissionDeniedHint)
    changes.push(
      `无权限提示：${fmtText(before.permissionDeniedHint)}→${fmtText(after.permissionDeniedHint)}`,
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
      `${tier.baseCredits}积分`,
      `原价¥${tier.originalPrice}`,
      fmtDiscount(tier.discount),
      `实付¥${tier.price}`,
      `状态${tierStatusLabel(tier.status)}`,
    ];
    if (tier.startTime) parts.push(`生效${fmtAuditTime(tier.startTime)}`);
    if (tier.endTime) parts.push(`失效${fmtAuditTime(tier.endTime)}`);
    if (tier.bonusCredits > 0)
      parts.push(`首购赠${tier.bonusCredits}积分`);
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
      detail: `删除档位：${before.baseCredits}积分，原价¥${before.originalPrice}，实付¥${before.price}`,
    });
  }
}
