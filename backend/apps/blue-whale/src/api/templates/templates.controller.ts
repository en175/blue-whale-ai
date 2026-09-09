import { Controller, Get, Query } from "@nestjs/common";
import { DomainError, FAILURE_CODE, ok } from "@blue-whale/contracts";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { TemplateService } from "@lib/shared/template/template.service.js";
import {
  isValidTagCode,
  listTemplateTags,
} from "@lib/shared/template/template-validation.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";

@Controller("agent/templates")
export class AgentTemplatesController {
  constructor(private readonly template: TemplateService) {}

  @Public()
  @Get("page")
  async page(@Query() query: Record<string, string> = {}) {
    const tagCode = query.tagCode ?? "";
    if (!isValidTagCode(tagCode)) {
      // 这是 @Get，默认状态 200——不抛的话回的是 HTTP 200 而 body 写着 400，
      // 只看状态码的客户端会把「非法标签」当成一页空结果。
      throw new DomainError(FAILURE_CODE, `非法标签: ${tagCode}`);
    }
    const result = await this.template.pageByTagCode(
      tagCode,
      Math.max(1, Number(query.page ?? "1") || 1),
      Math.max(1, Number(query.size ?? "10") || 10),
    );
    return ok(result);
  }

  @Public()
  @Get("tags")
  async tags() {
    try {
      const tags = await this.template.listTags();
      if (tags.length > 0) return ok(tags);
    } catch (e) {
      logger.error(
        `[templates/tags] DB 读取失败，兜底硬编码枚举: ${e instanceof Error ? e.message : e}`,
      );
    }
    return ok(listTemplateTags());
  }
}
