/**
 * CardMessage —— 对话流中 card 变体的类型提取。
 *
 * card 转画布节点的纯函数（nodeFromCard）已随 Canvas v2 迁移下线，
 * 但 CardMessage 类型被 AgentChatPanel / ChatPanelMessageStream /
 * v2 mappers / canvas surface runtime 多处引用，保留为活类型。
 */
import type { ChatMessage } from "./types";

export type CardMessage = Extract<ChatMessage, { type: "card" }>;
