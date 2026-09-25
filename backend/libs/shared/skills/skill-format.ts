import { createControlledChatClient } from "./controlled-chat-client.js";
import { ok, skillError } from "@lib/contracts";
import { parseSkillMd } from "@lib/core";
import { newApiBaseUrl } from "@lib/shared/upstream/new-api-egress.js";
import type { SystemSettingsService } from "@lib/shared/system-settings/index.js";

export type SkillFormatChatClient = {
  complete(input: { rules: string; draft: string }): Promise<string>;
};

export function createSkillFormatChatClient(options: {
  baseUrl: string;
  token: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): SkillFormatChatClient {
  const client = createControlledChatClient(options);
  return {
    async complete({ rules, draft }) {
      return client.complete({
        rules,
        messages: [{ role: "user", content: draft }],
      });
    },
  };
}

export const DEFAULT_SKILL_FORMAT_RULES = `你是 SKILL.md 格式化助手。按以下固定规则处理用户给出的草稿，只输出格式化后的完整 SKILL.md 原文：
1. 保留草稿的原始语义与功能意图，不新增、不删除能力描述。
2. 规范 YAML frontmatter：确保包含非空的 name 与 description 字段，取值简洁清晰。
3. 整理正文 Markdown 结构：统一标题层级、列表与段落格式，去除多余空行。
4. 输出必须是可以直接保存的完整 SKILL.md 文本（以 --- 开头），不要输出代码围栏、解释或额外对话。`;

export function loadSkillFormatRules(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env.SKILL_FORMAT_RULES?.trim();
  return override || DEFAULT_SKILL_FORMAT_RULES;
}

/**
 * 组装 AI 格式化的依赖。
 *
 * <p>地址与凭证都从上游唯一出口的语义取：地址直接读 `NEW_API_BASE_URL`，
 * 凭证走 `SystemSettingsService.requireUpstreamKey()`（**读库，所以这个函数是异步的**）。
 * 这里就是一次普通的模型调用，用项目统一 key 即可——不需要、也不该有专属凭证。
 *
 * <p>配不出来就返回 null（调用方翻成「AI 格式化未配置」503）：缺 model、缺地址、
 * 缺凭证三者对外都是「这个功能现在不可用」，而**绝不带着空串去打上游**。
 */
export async function createSkillFormatDeps(
  settings: Pick<SystemSettingsService, "requireUpstreamKey">,
): Promise<{ ai: SkillFormatChatClient; rules: string } | null> {
  const model = process.env.SKILL_FORMAT_MODEL;
  if (!model) return null;
  let baseUrl: string;
  let token: string;
  try {
    baseUrl = newApiBaseUrl();
    token = await settings.requireUpstreamKey();
  } catch {
    return null;
  }
  return {
    ai: createSkillFormatChatClient({ baseUrl, token, model }),
    rules: loadSkillFormatRules(),
  };
}

export async function handleFormatSkillDraft(
  content: string,
  deps: { ai: SkillFormatChatClient; rules: string },
) {
  if (!content.trim()) throw skillError("SKILL_FORMAT_INVALID", "草稿内容为空，无法格式化");
  let formatted: string;
  try {
    formatted = await deps.ai.complete({ rules: deps.rules, draft: content });
  } catch {
    throw skillError("SKILL_FORMAT_FAILED");
  }
  const parsed = typeof formatted === "string" ? parseSkillMd(formatted) : null;
  if (
    !parsed ||
    !parsed.name.trim() ||
    !parsed.description.trim() ||
    !parsed.body.trim()
  ) {
    throw skillError("SKILL_FORMAT_FAILED", "AI 返回内容无效，已保留原草稿");
  }
  return ok({ content: formatted });
}
