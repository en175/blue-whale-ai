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
  parseTierDiscount,
  parseTierOriginalPrice,
} from "@lib/shared/topup-tier/constants.js";
import { TopupTierService } from "@lib/shared/topup-tier/topup-tier.service.js";
import { deriveCredits } from "@lib/shared/recharge/recharge.service.js";
import { fetchCreditsPerYuan } from "@lib/shared/billing/billing-admin-client.js";

const BIGINT_ID_RE = /^\d{1,19}$/;

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
        data: tiers.map((t) => ({
          ...t,
          amount: deriveCredits(t.originalPrice, creditsPerYuan),
        })),
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
    try {
      const tier = await this.topupTier.create({
        amount: deriveCredits(originalPrice, await fetchCreditsPerYuan()),
        originalPrice,
        discount,
        ...(name ? { name } : {}),
        isRecommended: body.isRecommended === true,
        status: body.status === "inactive" ? "inactive" : "active",
        startTime:
          typeof body.startTime === "string" && body.startTime
            ? body.startTime
            : null,
        endTime:
          typeof body.endTime === "string" && body.endTime ? body.endTime : null,
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
        ...(body.status !== undefined && {
          status: body.status === "inactive" ? "inactive" : "active",
        }),
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
