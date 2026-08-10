/**
 * messages —— 消息生成的纯函数（从 AgentChatPanel 剥离的可测逻辑）
 *
 * buildMockReply 返回离线 mock 回复消息序列（thinking → agent 文本 → card）。
 * 这是不含 user 消息本身的"回复部分"，user 消息由组件自行追加。
 *
 * idGen 被注入以避免 Date.now() 在测试中不可控（消除"既算又测"的同义反复）。
 */
import type { ChatMessage } from "./types";

export type IdGenerator = () => number | string;

/**
 * 生成离线 mock 回复消息序列（不含 user 消息本身）。
 *
 * @param userText  用户输入文本，用于派生回复文案
 * @param idGen     id 生成器，注入以便测试可控
 */
export function buildMockReply(
  userText: string,
  idGen: IdGenerator,
): ChatMessage[] {
  // thinking → 若干 agent 文本 → 最终 card
  return [
    {
      id: idGen(),
      type: "thinking",
      text: "思考过程",
      content: userText,
    },
    {
      id: idGen(),
      type: "agent",
      text: `正在按你的指令处理：${userText}`,
    },
    {
      id: idGen(),
      type: "card",
      text: userText,
      meta: "1:1",
      status: "normal",
      // DEMO-only：离线 mock 卡，无 generationJobId/assetId；
      // 画布节点仅由用户点「手动应用」前端直插产生（见 handleReapply normal 分支）。
    },
  ];
}
