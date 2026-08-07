/** SKILL.md AI 格式化的受控 chat 客户端（IK60X0）。
 *  网络实现共用 @blue-whale/agent-runtime 的受控客户端（ik6b3l 收拢拷贝）；
 *  本层仅把单条草稿包装为 user 消息。baseUrl / token / model 全部由服务端
 *  env 注入，浏览器不可见。fetchImpl 注入即可控 AI 替身缝（单测不触网）。 */
import { createControlledChatClient } from "@blue-whale/agent-runtime";

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
