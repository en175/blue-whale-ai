import { Controller, Get, Query } from "@nestjs/common";
import { DomainError, FAILURE_CODE, ok } from "@lib/contracts";
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
    const tagCode = (query.tagCode ?? "").trim();
    if (tagCode) {
      let valid: boolean;
      try {
        const tags = await this.template.listAllTags();
        valid =
          tags.length > 0
            ? tags.some((tag) => tag.tag_code === tagCode)
            : isValidTagCode(tagCode);
      } catch (e) {
        valid = isValidTagCode(tagCode);
        logger.error(
          `[templates/page] 标签读取失败，回退静态枚举: ${e instanceof Error ? e.message : e}`,
        );
      }
      if (!valid) {
        throw new DomainError(FAILURE_CODE, `非法标签: ${tagCode}`);
      }
    }
    const result = await this.template.pageCards({
      ...(tagCode ? { tagCode } : {}),
      ...(query.isFeatured === "1" ? { isFeatured: true } : {}),
      current: Math.max(1, Number(query.page ?? "1") || 1),
      size: Math.max(1, Number(query.size ?? "10") || 10),
    });
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
