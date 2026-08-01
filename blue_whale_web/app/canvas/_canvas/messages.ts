/**
 * messages —— 消息生成的纯函数（从 AgentChatPanel 剥离的可测逻辑）
 *
 * buildMockReplyForMode 按当前创作模式（Agent / Direct Gen）返回 mock 回复消息序列。
 * 这是不含 user 消息本身的"回复部分"，user 消息由组件自行追加。
 *
 * idGen 被注入以避免 Date.now() 在测试中不可控（消除"既算又测"的同义反复）。
 */
import type { ChatMessage } from "./types";

export type CreationMode = "agent" | "direct";

export type IdGenerator = () => number | string;

/**
 * 按创作模式生成 mock 回复消息序列（不含 user 消息本身）。
 *
 * @param mode      创作模式，取自 selectedMode.id（"agent" | "direct"）
 * @param userText  用户输入文本，用于派生回复文案
 * @param idGen     id 生成器，注入以便测试可控
 */
export function buildMockReplyForMode(
  mode: CreationMode,
  userText: string,
  idGen: IdGenerator,
): ChatMessage[] {
  if (mode === "direct") {
    return [
      {
        id: idGen(),
        type: "card",
        text: `${userText}（已生成图片卡片）`,
        meta: "1:1",
        status: "normal",
      },
    ];
  }

  // Agent 模式：thinking → 若干 agent 文本 → 最终 card
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
    },
  ];
}
