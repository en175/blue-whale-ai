import { Controller, Get, Logger, Query } from "@nestjs/common";
import { fail, ok } from "@blue-whale/contracts";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { TemplateService } from "@lib/shared/template/template.service.js";
import {
  isValidTagCode,
  listTemplateTags,
} from "@lib/shared/template/template-validation.js";

@Controller("agent/templates")
export class AgentTemplatesController {
  private readonly logger = new Logger(AgentTemplatesController.name);

  constructor(private readonly template: TemplateService) {}

  @Public()
  @Get("page")
  async page(@Query() query: Record<string, string> = {}) {
    const tagCode = query.tagCode ?? "";
    if (!isValidTagCode(tagCode)) {
      return fail(400, `非法标签: ${tagCode}`);
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
      this.logger.error(
        `[templates/tags] DB 读取失败，兜底硬编码枚举: ${e instanceof Error ? e.message : e}`,
      );
    }
    return ok(listTemplateTags());
  }
}
