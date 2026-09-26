import {
  Body,
  Controller,
  Delete,
  Get,
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
  parseCreditsValidMonths,
  parseNonNegativeInt,
  parseTierAllowlist,
  parseTierDiscount,
  parseTierOriginalPrice,
  parseTierPermission,
  parseTierStatus,
} from "@lib/shared/topup-tier/constants.js";
import { TopupTierService } from "@lib/shared/topup-tier/topup-tier.service.js";
import type {
  TopupTierPermission,
  TopupTierStatus,
} from "@lib/shared/persistence/index.js";
import { deriveCredits } from "@lib/shared/recharge/recharge.service.js";
import { fetchCreditsPerYuan } from "@lib/shared/billing/billing-admin-client.js";

const BIGINT_ID_RE = /^\d{1,19}$/;

const STATUS_HINT = TOPUP_TIER_STATUSES.join(" | ");
const PERMISSION_HINT = TOPUP_TIER_PERMISSIONS.join(" | ");

/**
 * PRD §10.2 里「名称 / 原价 / 折扣 / 状态 / 时间窗 / 推荐 / 排序」之外的那批字段。
 *
 * <p>**支付价格（price）与基础积分（amount）刻意不在这里**：它们是从原价与折扣
 * 派生出来的（`price = 原价 × 折扣`、`amount = 原价 × 换算率`），不是运营的输入框。
 * 收下它们就等于允许「原价 100、积分写 999999」这种自相矛盾的档位存进库。
 */
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

/** 选填文本：必须是字符串，且不超过列宽（超了 MySQL 严格模式会 500，这里提前 400）。 */
function requireText(raw: unknown, label: string, maxLength: number): string {
  if (typeof raw !== "string") throw new AdminException(400, `${label}须为文本`);
  const text = raw.trim();
  if (text.length > maxLength) {
    throw new AdminException(400, `${label}最长 ${maxLength} 个字符`);
  }
  return text;
}

/** 状态：不认得的 → 400。**不做「非法值当草稿」的兜底**——那会让人以为自己改成功了。 */
function requireStatus(raw: unknown): TopupTierStatus {
  const status = parseTierStatus(raw);
  if (status === null) throw new AdminException(400, `状态须为 ${STATUS_HINT}`);
  return status;
}

/**
 * 读 PRD §10.2 的卡片字段，**只返回显式传了的键**。
 *
 * <p>新建与编辑共用这一个函数：新建时缺的键由 repo 落默认值，
 * 编辑时缺的键保持不变。非法值一律 400，不静默回退到默认值。
 */
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
    // null = 显式清空；数组 = 覆盖成这份名单（空数组 = 名单为空，两者物理落点不同）
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
    private readonly topupTier: TopupTierService,
    private readonly tierAudit: TierAuditService,
  ) {}

  @Get()
  async list() {
    try {
      const tiers = await this.topupTier.listAll();
      // ⚠️ **读的时候重新派生，不信库里那一列**：`topup_tiers.amount` 的存量行是
      // new-api 记账时代写进去的 quota（原价 × 500_000），即 ¥100 档存着 5,000,000，
      // 而用户端卡片现在显示 1,500。只在写入时改成新公式的话，**老数据永远是错的**——
      // 管理员看到一个数、用户看到另一个数，正是这次要消掉的那种不一致。
      // 派生是幂等的，与写入侧用的是同一个 deriveCredits（同一条公式、同一处来源）。
      const creditsPerYuan = await fetchCreditsPerYuan();
      return {
        success: true,
        data: {
          tiers: tiers.map((t) => {
            const amount = deriveCredits(t.originalPrice, creditsPerYuan);
            return { ...t, amount, name: displayTierName(t.name, amount) };
          }),
          // ★ 把换算率**一并回给管理端**，不是顺手多带一个字段。
          //
          //   编辑表单要**边输价格边显示会到账多少积分**，而那个数只能用它算。
          //   在此之前前端是本地写死「×10」派生的（`price × 500000 / 50000`），
          //   于是同一页出现两个数：表单预览按 10 算、表格里按换算率算。
          //   2026-09-26 实测：本地库的换算是 **15**，那一页的预览与列表就已经对不上了。
          //
          //   ⚠️ 不要再让前端自己算「每元多少积分」——它算不出来，那是运行时配置
          //      （住在 billing 的定价目录里，运营随时可改）。回给它，它就不需要猜。
          creditsPerYuan,
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
    // PRD §10.5：**新建卡片默认草稿**，不展示给用户。运营配齐字段后再显式上架。
    const status = body.status === undefined ? "draft" : requireStatus(body.status);
    const cardFields = readCardFields(body);
    try {
      const tier = await this.topupTier.create({
        amount: deriveCredits(originalPrice, await fetchCreditsPerYuan()),
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
        // best-effort 审计，失败不阻断
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
        ...(originalPrice !== null && {
          originalPrice,
          amount: deriveCredits(originalPrice, await fetchCreditsPerYuan()),
        }),
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
        // best-effort 审计，失败不阻断
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
        // best-effort 审计，失败不阻断
      }
    }
    return { success: true };
  }
}
