import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";
import { TierAuditService } from "@lib/shared/topup-tier/tier-audit.service.js";
import {
  TOPUP_TIER_PERMISSIONS,
  TOPUP_TIER_STATUSES,
  displayTierName,
  parseBaseCredits,
  parseCreditsValidMonths,
  parseNonNegativeInt,
  parseTierAllowlist,
  parseTierDiscount,
  parseTierOriginalPrice,
  parseTierPermission,
  parseTierStatus,
} from "@lib/shared/topup-tier/constants.js";
import { TOPUP_TIER_REPO_TOKEN } from "@lib/shared/topup-tier/topup-tier.tokens.js";
import type {
  TopupTierPermission,
  TopupTierRepo,
  TopupTierStatus,
} from "@lib/shared/persistence/index.js";

const BIGINT_ID_RE = /^\d{1,19}$/;

const STATUS_HINT = TOPUP_TIER_STATUSES.join(" | ");
const PERMISSION_HINT = TOPUP_TIER_PERMISSIONS.join(" | ");

interface TierCardFields {
  description: string;
  bonusCredits: number;
  activityTag: string;
  buttonText: string;
  firstPurchaseEligible: boolean;
  creditsValidMonths: number;
  permission: TopupTierPermission;
  permissionAllowlist: string[] | null;
  permissionDeniedHint: string;
}

function requireText(raw: unknown, label: string, maxLength: number): string {
  if (typeof raw !== "string") throw new AdminException(400, `${label}须为文本`);
  const text = raw.trim();
  if (text.length > maxLength) {
    throw new AdminException(400, `${label}最长 ${maxLength} 个字符`);
  }
  return text;
}

function requireStatus(raw: unknown): TopupTierStatus {
  const status = parseTierStatus(raw);
  if (status === null) throw new AdminException(400, `状态须为 ${STATUS_HINT}`);
  return status;
}

function readCardFields(body: Record<string, unknown>): Partial<TierCardFields> {
  const out: Partial<TierCardFields> = {};

  if (body.description !== undefined) {
    out.description = requireText(body.description, "卡片说明", 255);
  }
  if (body.activityTag !== undefined) {
    out.activityTag = requireText(body.activityTag, "活动标签", 64);
  }
  if (body.buttonText !== undefined) {
    out.buttonText = requireText(body.buttonText, "按钮文案", 32);
  }
  if (body.permissionDeniedHint !== undefined) {
    out.permissionDeniedHint = requireText(body.permissionDeniedHint, "无权限提示", 255);
  }
  if (body.bonusCredits !== undefined) {
    const n = parseNonNegativeInt(body.bonusCredits);
    if (n === null) throw new AdminException(400, "赠送积分须为非负整数");
    out.bonusCredits = n;
  }
  if (body.creditsValidMonths !== undefined) {
    const months = parseCreditsValidMonths(body.creditsValidMonths);
    if (months === null) {
      throw new AdminException(400, "积分有效期须为 1–1200 的整数（单位：月）");
    }
    out.creditsValidMonths = months;
  }
  if (body.firstPurchaseEligible !== undefined) {
    if (typeof body.firstPurchaseEligible !== "boolean") {
      throw new AdminException(400, "是否参与首购须为布尔值");
    }
    out.firstPurchaseEligible = body.firstPurchaseEligible;
  }
  if (body.permission !== undefined) {
    const permission = parseTierPermission(body.permission);
    if (permission === null) {
      throw new AdminException(400, `购买权限须为 ${PERMISSION_HINT}`);
    }
    out.permission = permission;
  }
  if (body.permissionAllowlist !== undefined) {
    if (body.permissionAllowlist === null) {
      out.permissionAllowlist = null;
    } else {
      const list = parseTierAllowlist(body.permissionAllowlist);
      if (list === null) {
        throw new AdminException(400, "权限白名单须为 userId 数组（十进制字符串或安全整数）");
      }
      out.permissionAllowlist = list;
    }
  }
  return out;
}

@Controller("admin/topup-tiers")
@UseGuards(AdminGuard)
export class AdminTopupTiersController {
  constructor(
    @Inject(TOPUP_TIER_REPO_TOKEN)
    private readonly topupTier: TopupTierRepo,
    private readonly tierAudit: TierAuditService,
  ) {}

  @Get()
  async list() {
    try {
      const tiers = await this.topupTier.listAll();
      return {
        success: true,
        data: {
          tiers: tiers.map((t) => ({
            ...t,
            name: displayTierName(t.name, t.baseCredits),
          })),
        },
      };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Get("preview")
  async preview() {
    try {
      const tiers = await this.topupTier.listActive();
      return { success: true, data: tiers };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Put("sync")
  async sync() {
    try {
      const tiers = await this.topupTier.listActive();
      return {
        success: true,
        data: { synced: 0, total: tiers.length },
        warning: "产品充值已改为代收，不再同步折扣到 Go",
      };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Post()
  async create(@Body() body: Record<string, unknown>) {
    const originalPrice = parseTierOriginalPrice(body.originalPrice);
    if (originalPrice === null) {
      throw new AdminException(400, "原价须为正整数（元）");
    }
    const discount = parseTierDiscount(body.discount);
    if (discount === null) {
      throw new AdminException(400, "折扣比例须在 (0, 1] 之间");
    }
    const baseCredits = parseBaseCredits(body.baseCredits);
    if (baseCredits === null) {
      throw new AdminException(400, "基础积分须为 1 以上的整数（0 积分的档位无法下单）");
    }

    const existing = await this.topupTier.listAll();
    const clash = existing.find(
      (t) => Math.round(t.originalPrice) === originalPrice,
    );
    if (clash) {
      throw new AdminException(
        409,
        `每个原价只能有一个档位：已存在原价 ¥${originalPrice} 的档位`,
      );
    }

    const name = typeof body.name === "string" ? body.name : "";
    const status = body.status === undefined ? "draft" : requireStatus(body.status);
    const cardFields = readCardFields(body);
    try {
      const tier = await this.topupTier.create({
        baseCredits,
        originalPrice,
        discount,
        ...(name ? { name } : {}),
        isRecommended: body.isRecommended === true,
        status,
        startTime:
          typeof body.startTime === "string" && body.startTime
            ? body.startTime
            : null,
        endTime:
          typeof body.endTime === "string" && body.endTime ? body.endTime : null,
        ...cardFields,
      });

      try {
        await this.tierAudit.logCreate(tier);
      } catch {
      }

      return { success: true, data: tier };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Put("sort")
  async sort(@Body() body: { items?: { id: string; sortOrder: number }[] }) {
    const { items } = body ?? {};
    if (!Array.isArray(items) || items.length === 0) {
      throw new AdminException(400, "缺少排序数据");
    }
    const invalid = items.find(
      (i) =>
        typeof i.id !== "string" ||
        !BIGINT_ID_RE.test(i.id) ||
        !Number.isInteger(i.sortOrder),
    );
    if (invalid) {
      throw new AdminException(400, "排序项 id 须为正整数、sortOrder 须为整数");
    }
    try {
      await this.topupTier.updateSortOrder(
        items.map((i) => ({ id: i.id, sortOrder: i.sortOrder })),
      );
      const tiers = await this.topupTier.listAll();
      return { success: true, data: tiers };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Put(":id")
  async update(
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    let originalPrice: number | null = null;
    if (body.originalPrice !== undefined) {
      originalPrice = parseTierOriginalPrice(body.originalPrice);
      if (originalPrice === null) {
        throw new AdminException(400, "原价须为正整数（元）");
      }
    }
    let discount: number | undefined;
    if (body.discount !== undefined) {
      discount = parseTierDiscount(body.discount) ?? undefined;
      if (discount === undefined) {
        throw new AdminException(400, "折扣比例须在 (0, 1] 之间");
      }
    }
    let baseCredits: number | undefined;
    if (body.baseCredits !== undefined) {
      baseCredits = parseBaseCredits(body.baseCredits) ?? undefined;
      if (baseCredits === undefined) {
        throw new AdminException(400, "基础积分须为 1 以上的整数（0 积分的档位无法下单）");
      }
    }
    let status: TopupTierStatus | undefined;
    if (body.status !== undefined) {
      status = requireStatus(body.status);
    }
    const cardFields = readCardFields(body);

    const before = await this.topupTier.getById(id);
    if (!before) {
      throw new AdminException(404, "档位不存在");
    }

    if (originalPrice !== null) {
      const all = await this.topupTier.listAll();
      const clash = all.find(
        (t) => t.id !== id && Math.round(t.originalPrice) === originalPrice,
      );
      if (clash) {
        throw new AdminException(
          409,
          `每个原价只能有一个档位：已存在原价 ¥${originalPrice} 的档位`,
        );
      }
    }

    try {
      const tier = await this.topupTier.update(id, {
        ...(originalPrice !== null && { originalPrice }),
        ...(baseCredits !== undefined && { baseCredits }),
        ...(discount !== undefined && { discount }),
        ...(typeof body.name === "string" && { name: body.name }),
        ...(typeof body.isRecommended === "boolean" && {
          isRecommended: body.isRecommended,
        }),
        ...(status !== undefined && { status }),
        ...(body.startTime !== undefined && {
          startTime:
            typeof body.startTime === "string" && body.startTime
              ? body.startTime
              : null,
        }),
        ...(body.endTime !== undefined && {
          endTime:
            typeof body.endTime === "string" && body.endTime
              ? body.endTime
              : null,
        }),
        ...cardFields,
      });

      if (!tier) {
        throw new AdminException(404, "档位不存在");
      }

      try {
        await this.tierAudit.logUpdate(before, tier);
      } catch {
      }

      return { success: true, data: tier };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Delete(":id")
  async remove(@Param("id") id: string) {
    const before = await this.topupTier.getById(id);
    const ok = await this.topupTier.remove(id);
    if (!ok) {
      throw new AdminException(404, "档位不存在");
    }

    if (before) {
      try {
        await this.tierAudit.logDelete(before);
      } catch {
      }
    }
    return { success: true };
  }
}
