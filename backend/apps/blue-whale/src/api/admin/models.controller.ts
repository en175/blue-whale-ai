import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";
import { ModelAuditService } from "@lib/shared/model-capability/model-audit.service.js";
import { ModelCapabilityAdminService } from "@lib/shared/model-capability/model-capability-admin.service.js";
import {
  parseModelCreateBody,
  parseModelUpdateBody,
} from "@lib/shared/model-capability/constants.js";
import { invalidateModelCapabilityCache } from "@lib/shared/persistence/index.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

const BIGINT_ID_RE = /^\d{1,19}$/;

@Controller("admin/models")
@UseGuards(AdminGuard)
export class AdminModelsController {
  constructor(
    private readonly modelCapability: ModelCapabilityAdminService,
    private readonly modelAudit: ModelAuditService,
  ) {}

  @Get()
  async list() {
    try {
      const models = await this.modelCapability.listAll();
      return { success: true, data: models };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  /** 手动清空消费端模型能力缓存（IKH BDO）。
   *
   *  正常路径由各写方法自动失效；这个入口兜的是「绕过应用的改动」——迁移脚本、直改库，
   *  或 Redis 短暂失联期间漏掉的失效。没有它就只能干等 5 分钟 TTL。
   *  必须声明在 `@Post()` 之外：路径含斜杠，不会被 create 抢。 */
  @Post("cache/flush")
  async flushCache() {
    await invalidateModelCapabilityCache();
    return { success: true, data: { flushed: true } };
  }

  @Post()
  async create(
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const parsed = parseModelCreateBody(body);
    if (!parsed.ok) throw new AdminException(400, parsed.error);
    try {
      const result = await this.modelCapability.create(parsed.value);
      if (!result.ok) {
        throw new AdminException(
          409,
          `同供应商模型已存在：${parsed.value.provider_id}/${parsed.value.model_id}（含已软删，不可复用）`,
        );
      }
      try {
        await this.modelAudit.logCreate(result.row, user.username);
      } catch {
        // best-effort 审计，失败不阻断
      }
      return { success: true, data: result.row };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }

  @Put("reorder")
  async reorder(
    @Body() body: { items?: { id: string; sortOrder: number }[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { items } = body ?? {};
    if (!Array.isArray(items) || items.length === 0) {
      throw new AdminException(400, "缺少排序数据");
    }
    const invalid = items.find(
      (i) =>
        typeof i.id !== "string" ||
        !BIGINT_ID_RE.test(i.id) ||
        !Number.isInteger(i.sortOrder) ||
        i.sortOrder < 0 ||
        i.sortOrder > 2_147_483_647,
    );
    if (invalid) {
      throw new AdminException(
        400,
        "排序项 id 须为正整数、sortOrder 须为非负整数（≤2147483647）",
      );
    }
    try {
      const all = await this.modelCapability.listAll();
      const modelIdByRowId = new Map(all.map((m) => [m.id, m.model_id]));
      const result = await this.modelCapability.updateSortOrder(items);
      if (!result.ok) {
        throw new AdminException(404, `模型不存在或已删除: ${result.missingId}`);
      }
      try {
        await this.modelAudit.logReorder(
          items.map((i) => ({
            id: i.id,
            model_id: modelIdByRowId.get(i.id) ?? i.id,
            sortOrder: i.sortOrder,
          })),
          user.username,
        );
      } catch {
        // best-effort 审计，失败不阻断
      }
      return { success: true, data: await this.modelCapability.listAll() };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }

  @Put(":id")
  async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    try {
      // IKH BDO：先读库中那一行，再做请求体校验——更新是 diff 提交，没改过的
      // channel_parser 不在 body 里，映射表校验必须按库中的解析器判定。
      // 这里必须读库、不得读缓存：拿旧值校验等于没校验。
      const before = await this.modelCapability.getById(id);
      if (!before) throw new AdminException(404, "模型不存在");
      const parsed = parseModelUpdateBody(body, before);
      if (!parsed.ok) throw new AdminException(400, parsed.error);
      const after = await this.modelCapability.update(id, parsed.value);
      if (!after) throw new AdminException(404, "模型不存在");
      try {
        await this.modelAudit.logUpdate(before, after, user.username);
      } catch {
        // best-effort 审计，失败不阻断
      }
      return { success: true, data: after };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }

  @Patch(":id/toggle")
  async toggle(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    try {
      const after = await this.modelCapability.toggleEnabled(id);
      if (!after) throw new AdminException(404, "模型不存在");
      try {
        await this.modelAudit.logToggle(after, user.username);
      } catch {
        // best-effort 审计，失败不阻断
      }
      return { success: true, data: after };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }

  /** 设为该能力类型的默认模型（IKE0VX）。
   *
   *  为什么不复用 PUT :id：那个方法是单行全字段写，而这件事必然要动同类的**其它**行。
   *  把跨行副作用藏进一个看起来只改一行的接口里，是下一个人看不懂 diff 的起点。
   *
   *  为什么不做成 toggle：取消默认之后就没有默认了，消费端回落到列表第一条——正是本单
   *  要消灭的那个状态。它可以由「改设别的模型」达成，不该由一次误点达成。 */
  @Patch(":id/default")
  async setDefault(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    try {
      const after = await this.modelCapability.setDefault(id);
      if (!after) throw new AdminException(404, "模型不存在");
      try {
        await this.modelAudit.logSetDefault(after, user.username);
      } catch {
        // best-effort 审计，失败不阻断
      }
      return { success: true, data: await this.modelCapability.listAll() };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }

  @Delete(":id")
  async remove(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    try {
      const before = await this.modelCapability.getById(id);
      const ok = await this.modelCapability.remove(id);
      if (!ok) throw new AdminException(404, "模型不存在");
      if (before) {
        try {
          await this.modelAudit.logDelete(before, user.username);
        } catch {
          // best-effort 审计，失败不阻断
        }
      }
      return { success: true };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }
}
