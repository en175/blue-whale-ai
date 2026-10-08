import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";
import { OperationLogService } from "@lib/shared/operation-log/operation-log.service.js";
import type {
  RechargeCustomConfigView,
  SaveRechargeCustomConfigInput,
} from "@lib/shared/persistence/index.js";
import {
  parseCustomPermission,
  parseCustomPermissionAllowlist,
} from "@lib/shared/recharge-custom/constants.js";
import { RechargeCustomService } from "@lib/shared/recharge-custom/recharge-custom.service.js";
import {
  TOPUP_TIER_PERMISSIONS,
  parseCreditsValidMonths,
  parseNonNegativeInt,
  tierPermissionLabel,
} from "@lib/shared/topup-tier/constants.js";

const PERMISSION_HINT = TOPUP_TIER_PERMISSIONS.join(" | ");
const MAX_HINT_LENGTH = 255;

function requirePositiveInt(raw: unknown, label: string): number {
  const n = parseNonNegativeInt(raw);
  if (n === null || n < 1) throw new AdminException(400, `${label}须为 1 以上的整数`);
  return n;
}

@Controller("admin/recharge-custom-config")
@UseGuards(AdminGuard)
export class AdminRechargeCustomConfigController {
  constructor(
    private readonly custom: RechargeCustomService,
    private readonly operationLog: OperationLogService,
  ) {}

  @Get()
  async get() {
    try {
      const config = await this.custom.requireConfig();
      return { success: true, data: toAdminView(config) };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Put()
  async update(@Body() body: Record<string, unknown>) {
    const input: SaveRechargeCustomConfigInput = {};

    if (body.minCredits !== undefined) {
      input.minCredits = requirePositiveInt(body.minCredits, "最低积分");
    }
    if (body.maxCredits !== undefined) {
      input.maxCredits = requirePositiveInt(body.maxCredits, "最高积分");
    }
    if (body.defaultCredits !== undefined) {
      input.defaultCredits = requirePositiveInt(body.defaultCredits, "默认积分");
    }
    if (body.creditsPerYuan !== undefined) {
      input.creditsPerYuan = requirePositiveInt(body.creditsPerYuan, "每元积分数");
    }
    if (body.stepCredits !== undefined) {
      input.stepCredits = requirePositiveInt(body.stepCredits, "积分步长");
    }
    if (body.creditsValidMonths !== undefined) {
      const months = parseCreditsValidMonths(body.creditsValidMonths);
      if (months === null) {
        throw new AdminException(400, "积分有效期须为 1–1200 的整数（单位：月）");
      }
      input.creditsValidMonths = months;
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") {
        throw new AdminException(400, "是否启用须为布尔值");
      }
      input.enabled = body.enabled;
    }
    if (body.permission !== undefined) {
      const permission = parseCustomPermission(body.permission);
      if (permission === null) {
        throw new AdminException(400, `购买权限须为 ${PERMISSION_HINT}`);
      }
      input.permission = permission;
    }
    if (body.permissionAllowlist !== undefined) {
      if (body.permissionAllowlist === null) {
        input.permissionAllowlist = null;
      } else {
        const list = parseCustomPermissionAllowlist(body.permissionAllowlist);
        if (list === null) {
          throw new AdminException(
            400,
            "权限白名单须为 userId 数组（十进制字符串或安全整数）",
          );
        }
        input.permissionAllowlist = list;
      }
    }
    if (body.permissionDeniedHint !== undefined) {
      if (typeof body.permissionDeniedHint !== "string") {
        throw new AdminException(400, "无权限提示须为文本");
      }
      const hint = body.permissionDeniedHint.trim();
      if (hint.length > MAX_HINT_LENGTH) {
        throw new AdminException(400, `无权限提示最长 ${MAX_HINT_LENGTH} 个字符`);
      }
      input.permissionDeniedHint = hint;
    }

    if (Object.keys(input).length === 0) {
      throw new AdminException(400, "没有可保存的字段");
    }

    let before: RechargeCustomConfigView;
    try {
      before = await this.custom.requireConfig();
    } catch (error) {
      throw toAdminError(error);
    }

    try {
      const after = await this.custom.saveConfig(input);
      await this.writeAudit(before, after);
      return { success: true, data: toAdminView(after) };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  private async writeAudit(
    before: RechargeCustomConfigView,
    after: RechargeCustomConfigView,
  ): Promise<void> {
    try {
      await this.operationLog.create({
        category: "recharge_custom",
        action: "编辑",
        target: "recharge_custom_config",
        detail: describeCustomConfigChanges(before, after),
        operator: "admin",
      });
    } catch {
    }
  }
}

export function describeCustomConfigChanges(
  before: RechargeCustomConfigView,
  after: RechargeCustomConfigView,
): string {
  const changes: string[] = [];
  if (before.minCredits !== after.minCredits) {
    changes.push(`最低积分：${before.minCredits}→${after.minCredits}`);
  }
  if (before.maxCredits !== after.maxCredits) {
    changes.push(`最高积分：${before.maxCredits}→${after.maxCredits}`);
  }
  if (before.defaultCredits !== after.defaultCredits) {
    changes.push(`默认积分：${before.defaultCredits}→${after.defaultCredits}`);
  }
  if (before.stepCredits !== after.stepCredits) {
    changes.push(`积分步长：${before.stepCredits}→${after.stepCredits}`);
  }
  if (before.creditsPerYuan !== after.creditsPerYuan) {
    changes.push(
      `每元积分数：${before.creditsPerYuan}→${after.creditsPerYuan}（影响新订单价格）`,
    );
  }
  if (before.enabled !== after.enabled) {
    changes.push(`启用：${before.enabled ? "是" : "否"}→${after.enabled ? "是" : "否"}`);
  }
  if (before.creditsValidMonths !== after.creditsValidMonths) {
    changes.push(
      `积分有效期：${before.creditsValidMonths}个月→${after.creditsValidMonths}个月`,
    );
  }
  if (before.permission !== after.permission) {
    changes.push(
      `购买权限：${tierPermissionLabel(before.permission)}→${tierPermissionLabel(after.permission)}`,
    );
  }
  if (before.permissionAllowlist.join(",") !== after.permissionAllowlist.join(",")) {
    changes.push(
      `权限白名单：${fmtAllowlist(before.permissionAllowlist)}→${fmtAllowlist(after.permissionAllowlist)}`,
    );
  }
  if (before.permissionDeniedHint !== after.permissionDeniedHint) {
    changes.push(
      `无权限提示：${before.permissionDeniedHint || "无"}→${after.permissionDeniedHint || "无"}`,
    );
  }
  return changes.length > 0 ? changes.join("；") : "保存自定义充值配置（无字段变更）";
}

function fmtAllowlist(list: string[]): string {
  if (list.length === 0) return "无";
  if (list.length <= 5) return list.join(",");
  return `${list.slice(0, 5).join(",")}…等 ${list.length} 人`;
}

function toAdminView(config: RechargeCustomConfigView) {
  return {
    ...config,
    permissionLabel: tierPermissionLabel(config.permission),
  };
}
