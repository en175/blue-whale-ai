import { Body, Controller, Headers, Post } from "@nestjs/common";
import { NewApiError } from "@lib/core";
import { authorizedAgentService, requiredDecimalHeader } from "@lib/shared/agent/internal-auth.js";
import { BypassTransform } from "@lib/infra/decorators/bypass-transform.decorator.js";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { SkillService } from "@lib/shared/skills/skills.service.js";



@Public()
@BypassTransform()
@Controller("internal/agent-skills")
export class InternalAgentSkillsController {
  constructor(private readonly skills: SkillService) {}

  @Post("resolve")
  async resolve(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-blue-whale-tenant-id") tenantId: string | undefined,
    @Headers("x-blue-whale-user-id") userHeader: string | undefined,
    @Body() body: unknown,
  ) {
    if (!authorizedAgentService(authorization)) {
      throw new NewApiError("服务凭证无效", 401, "unauthorized");
    }
    const userId = requiredDecimalHeader(userHeader);
    if (!tenantId?.trim() || !userId) {
      throw new NewApiError("缺少可信 Agent 上下文", 400, "invalid_context");
    }
    const creativeSkillId =
      typeof body === "object" && body !== null
        ? (body as { creative_skill_id?: unknown }).creative_skill_id
        : undefined;
    if (typeof creativeSkillId !== "string" || !creativeSkillId.trim()) {
      throw new NewApiError("Skill resolve 请求无效", 400, "invalid_request");
    }

    const skill = await this.skills.findAgentSkill(creativeSkillId.trim(), userId);
    if (!skill || !skill.body.trim()) {
      throw new NewApiError("技能不存在或无正文", 404, "skill_not_found");
    }
    return {
      creative_skill_id: skill.creative_skill_id,
      name: skill.name,
      description: skill.description,
      asset_domain: skill.asset_domain,
      body: skill.body,
    };
  }
}
