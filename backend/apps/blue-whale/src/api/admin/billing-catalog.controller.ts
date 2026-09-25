import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import {
  BillingAdminConfigError,
  BillingAdminError,
  CatalogRejectedError,
  fetchActiveCatalog,
  publishCatalog,
} from "@lib/shared/billing/billing-admin-client.js";
import { AdminException } from "@lib/shared/errors/admin-error.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

/**
 * 定价目录（管理端）：读当前生效版本、整份发布新版本。
 *
 * <p>它转发 billing 的管理端 HTTP 面（`/admin/catalogs`）—— 那个端口只在内网、**没有鉴权**，
 * 所以管理端页面不能直连，必须由这条过了 {@link AdminGuard} 的路由代打。
 * 这不是「多一层」，是把唯一对外开放的那道门放对位置。
 *
 * <h2>为什么只有一个「整份发布」的写入口</h2>
 *
 * billing 的目录是**整份文档 + 整份回滚**的：一个版本 = 一份 JSON，`document_hash` 与之一一对应，
 * job 提交时冻结 `catalog_version`，结算按冻结版本复现。所以这里**没有**「改某一行」的接口 ——
 * 行级增量发布会毁掉上面那条链路（改价会影响到已提交任务，而版本号再也复现不出当时的价）。
 * 前端因此是「读出整份 → 改 → 发布整份」，与后端契约一致。
 *
 * <p>⚠️ 由此带来一个**已知的并发语义**：两个人同时编辑时，后保存的那份整份覆盖先保存的那份
 *    （没有锁、没有版本前置校验）。界面必须把「你保存的是整份、且基于你打开时的版本」说清楚，
 *    并显示当前生效版本号，让人至少能看出「我手里的不是最新的」。
 */
@Controller("admin/billing-catalog")
@UseGuards(AdminGuard)
export class AdminBillingCatalogController {
  /**
   * GET /api/admin/billing-catalog
   *
   * <p>返回当前生效的定价目录**原文**（`document`）+ 版本号 / 内容 hash / 规则条数 / 换算率。
   * 回原文而不是让前端自己拼：它是「读回来改一改再整份发布」的起点，丢掉服务端不认识的字段
   * 或原文格式，一次「只改一个单价」的保存就会顺手改掉别的。
   *
   * <p>⚠️ 没有生效版本时 `catalogVersion = -1`、`document = ""`，**不报错**：
   *    那正是「从零建第一份目录」要处理的状态，报成 404 会让页面只能显示一个失败。
   */
  @Get()
  async active() {
    try {
      return { success: true, data: await fetchActiveCatalog() };
    } catch (error) {
      throw this.toAdminError(error);
    }
  }

  /**
   * POST /api/admin/billing-catalog
   *
   * <p>body：`{ document: string, note?: string }`。`document` 是**目录 JSON 文本**，
   * 原样转发给 billing（理由见 `publishCatalog` 的注释：存原文、对原文取 hash）。
   *
   * <p>校验只做「是不是一段非空文本」：**能不能编过由 billing 说了算**（那是唯一的校验时机，
   * 且它的报错指得出哪条规则配错了）。在这里再解析一遍文档，等于把同一套规则抄第二份 ——
   * 抄漏一条，就会出现「这里放行、那边拒绝」或者更糟的「两边都放行但结果不同」。
   */
  @Post()
  async publish(
    @CurrentUser() operator: AuthenticatedUser,
    @Body() body: Record<string, unknown>,
  ) {
    const document = typeof body.document === "string" ? body.document : "";
    if (!document.trim()) {
      throw new AdminException(400, "document 必填：请提交目录 JSON 文本");
    }
    const note = typeof body.note === "string" ? body.note.trim() : "";

    try {
      return {
        success: true,
        data: await publishCatalog({
          document,
          // 谁改的价必须在目录行上留名：这是事后唯一能回答「这版价是谁改的」的地方
          publishedBy: String(operator.userId),
          ...(note ? { note } : {}),
        }),
      };
    } catch (error) {
      throw this.toAdminError(error);
    }
  }

  /**
   * billing 的失败分类 → 管理端的 HTTP 语义。
   *
   * <p>**三类的处置方向不同，不能压成一个 500**：
   * 文档被拒是 400（改文档，运营自己能修）、地址没配与调用失败是 503（改配置 / 等服务）。
   * 压成一个「服务器错误」等于告诉运维「去查服务」，而真正该动的东西在别处。
   */
  private toAdminError(error: unknown): AdminException {
    if (error instanceof AdminException) return error;
    if (error instanceof CatalogRejectedError) return new AdminException(400, error.message);
    if (error instanceof BillingAdminConfigError || error instanceof BillingAdminError) {
      return new AdminException(503, error.message);
    }
    return new AdminException(500, error instanceof Error ? error.message : "未知错误");
  }
}
