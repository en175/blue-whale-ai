/**
 * nodeFromCard —— card 消息转 NodeItem 的纯函数（除位置外字段）
 *
 * "Card 与 NodeItem 是同一生成结果的两种视图"（见 CONTEXT.md）：
 * 对话流出现一张 card 的同一时刻，画布应出现一个对应 NodeItem。
 * 本函数只产出除位置（position）外的字段——位置依赖视口与容器（副作用源），
 * 由编排层 addNode 封装，纯函数不碰。
 *
 * 不带 imageUrl：渲染成 ImageNode 既有的灰色占位图标，content 取 card.text 作标题。
 */
import type { ChatMessage, NodeItem } from "./types";
import { parseAspectRatio } from "./aspectRatio";
import type { IdGenerator } from "./messages";

export type CardMessage = Extract<ChatMessage, { type: "card" }>;

/**
 * 把 card 转成 NodeItem（position 给 {0,0} 占位，位置留给 addNode）。
 *
 * @param card  对话流中的 card 消息
 * @param idGen id 生成器，注入以便测试可控
 */
export function nodeFromCard(card: CardMessage, idGen: IdGenerator): NodeItem {
  const { width, height } = parseAspectRatio(card.meta);
  return {
    id: String(idGen()),
    type: "image",
    position: { x: 0, y: 0 },
    width,
    height,
    content: card.text,
  };
}
