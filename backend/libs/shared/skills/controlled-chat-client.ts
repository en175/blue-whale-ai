
export interface ControlledChatMessage {
  role: string;
  content: string;
}

export type ControlledChatClient = {
  complete(input: {
    rules: string;
    messages: ControlledChatMessage[];
  }): Promise<string>;
};

export function createControlledChatClient(options: {
  baseUrl: string;
  token: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): ControlledChatClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  return {
    async complete({ rules, messages }) {
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
              ...messages.map((m) => ({ role: m.role, content: m.content })),
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
