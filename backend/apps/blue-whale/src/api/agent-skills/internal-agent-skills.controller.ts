import { timingSafeEqual } from "node:crypto";
import { Body, Controller, Headers, Post } from "@nestjs/common";
import { NewApiError } from "@blue-whale/core";
import { BypassTransform } from "@lib/infra/decorators/bypass-transform.decorator.js";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { SkillService } from "@lib/shared/skills/skills.service.js";

/**
 * Agent 解析用户点选的创作套路（IKALMC / IKAP6P）。
 *
 * 108 套路库的权威副本只有一份，就是本库的 creative_skill / creative_skill_version：它有
 * creative_skill_id、有版本、有个人技能、有分类与使用量，也正是用户在技能库里浏览和点选的
 * 那一份。agent 镜像里曾另外捆绑了一份同内容的文件副本，两份 id 体系不同
 * （`custom-ecom-tvc-product-ad` ⟷ `tvc_product_ad`），实测 108 个 id 一个都对不上，
 * 于是每一次「直接使用」在 agent 侧都判「不认识这条」，静默不生效。那份副本已删除，
 * agent 一律经本端点解析。
 *
 * 形制照 internal/agent-assets/resolve：服务令牌 + 可信上下文头，与用户令牌无关。用户身份
 * 仍然必须带，因为个人技能有归属——官方域对所有人可见，个人域只对 owner 可见。
 */
function authorizedService(header: string | undefined): boolean {
  const expected = process.env.AGENT_SERVICE_TOKEN?.trim();
  const supplied = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : "";
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

function requiredDecimalHeader(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && /^[1-9][0-9]*$/.test(normalized) ? normalized : null;
}

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
    if (!authorizedService(authorization)) {
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
    // 不存在、已删、或个人技能不属于这个用户，一律 404：不泄露存在性，也让 agent 能把
    // 「点了没用上」如实说给用户听，而不是当作没点过。
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
