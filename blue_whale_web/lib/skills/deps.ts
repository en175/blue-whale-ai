import { createSkillRepo, getPrismaClient } from "@blue-whale/persistence";
import { createSkillFormatChatClient } from "./format-ai-client";
import { loadSkillFormatRules } from "./format-rules";

/** Skills 用例依赖：wire Prisma skill repo。 */
export function createSkillsDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return { skills: createSkillRepo(getPrismaClient(databaseUrl)) };
}

/** AI 格式化 deps（IK60X0）：env 缺任一项按「未配置」返回 null（route 层转 100104），
 *  对齐 go-amount-discount 的「缺配置降级 null」先例。 */
export function createSkillFormatDeps() {
  const baseUrl = process.env.NEW_API_BASE_URL;
  const token = process.env.NEW_API_ROOT_ACCESS_TOKEN;
  const model = process.env.SKILL_FORMAT_MODEL;
  if (!baseUrl || !token || !model) return null;
  return {
    ai: createSkillFormatChatClient({ baseUrl, token, model }),
    rules: loadSkillFormatRules(),
  };
}
