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

/** 正整数（>= 1）。与 `parseBaseCredits` 同口径：0 / 负数 / 小数一律 400。 */
function requirePositiveInt(raw: unknown, label: string): number {
  const n = parseNonNegativeInt(raw);
  if (n === null || n < 1) throw new AdminException(400, `${label}须为 1 以上的整数`);
  return n;
}

/**
 * 自定义充值配置（模块 B，PRD §10.3）。
 *
 * <p>单行配置，只有读与保存两个动作 —— 没有新建/删除：**它本来就只有一份**，
 * 「删掉配置」不是一个有意义的状态（删了用户侧拿什么报价？）。
 * 要停用就改 `enabled = false`，那是一个能被展示、能被解释的状态。
 *
 * <p>⚠️ 保存时的整除 / 步长对齐校验在 `RechargeCustomService.saveConfig` 里，
 * 且是对**合并后的整份配置**校验：只改换算率同样会让上下限不再整分（PRD §7.1）。
 * 这里只负责把请求体解析成强类型，解析不了就 400。
 */
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

  /**
   * PUT /api/admin/recharge-custom-config
   *
   * <p>**部分更新**：只传要改的键，不传的保持原值。缺的键不落默认值 ——
   * 那会让「只改下限」的操作把上限悄悄重置成 499995。
   */
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
      // ⚠️ member_tier（指定会员等级）本阶段**只是占位、不生效**（PRD §10.4 阶段 2）。
      // 收下它，但别指望它挡住任何人 —— 见 `canPurchaseCustom` 的注释
      input.permission = permission;
    }
    if (body.permissionAllowlist !== undefined) {
      // null = 显式清空；数组 = 覆盖成这份名单（空数组 = 名单为空，两者物理落点不同）
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

  /** 审计是 best-effort：写不进去不阻断保存（配置本身已经落库了，回滚才是更大的错）。 */
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
      /* best-effort */
    }
  }
}

/** 配置改动的一句话 diff（审计里要能看出「改了什么」，不是「又保存了一次」）。 */
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
  // ⚠️ 换算率是**价格算法**的输入：改它等于改所有新订单的价格，审计里必须单独看得见
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

/** 管理端视图：加上中文枚举名，免得每个页面各写一份映射。 */
function toAdminView(config: RechargeCustomConfigView) {
  return {
    ...config,
    permissionLabel: tierPermissionLabel(config.permission),
  };
}
