/** AI 格式化固定场景规则（IK60X0）：后台配置、普通用户不可修改。
 *  默认常量即产品规则；部署侧可用服务端 env SKILL_FORMAT_RULES 覆盖，
 *  浏览器与面板用户均不可见、不可改。 */
export const DEFAULT_SKILL_FORMAT_RULES = `你是 SKILL.md 格式化助手。按以下固定规则处理用户给出的草稿，只输出格式化后的完整 SKILL.md 原文：
1. 保留草稿的原始语义与功能意图，不新增、不删除能力描述。
2. 规范 YAML frontmatter：确保包含非空的 name 与 description 字段，取值简洁清晰。
3. 整理正文 Markdown 结构：统一标题层级、列表与段落格式，去除多余空行。
4. 输出必须是可以直接保存的完整 SKILL.md 文本（以 --- 开头），不要输出代码围栏、解释或额外对话。`;

/** 读取生效的格式化规则：SKILL_FORMAT_RULES（纯空白视为未配置）覆盖默认常量。 */
export function loadSkillFormatRules(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env.SKILL_FORMAT_RULES?.trim();
  return override || DEFAULT_SKILL_FORMAT_RULES;
}
