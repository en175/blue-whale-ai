/** SKILL.md AI 格式化的受控 chat 客户端（IK60X0）。
 *  走 new-api（OpenAI 兼容 relay）/v1/chat/completions；
 *  baseUrl / token / model 全部由服务端 env 注入，浏览器不可见。
 *  fetchImpl 注入即可控 AI 替身缝（单测不触网），仿 new-api-client 模式。 */
export type SkillFormatChatClient = {
  complete(input: { rules: string; draft: string }): Promise<string>;
};

export function createSkillFormatChatClient(options: {
  baseUrl: string;
  token: string;
  model: string;
  fetchImpl?: typeof fetch;
  /** 单次请求超时（默认 30s）；超时按失败处理，前端保留原草稿。 */
  timeoutMs?: number;
}): SkillFormatChatClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  return {
    async complete({ rules, draft }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(`${options.baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options.token}`,
          },
          body: JSON.stringify({
            model: options.model,
            messages: [
              { role: "system", content: rules },
              { role: "user", content: draft },
            ],
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        throw new Error(`chat completions HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: unknown } }[];
      };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("chat completions 返回空内容");
      }
      return content;
    },
  };
}
