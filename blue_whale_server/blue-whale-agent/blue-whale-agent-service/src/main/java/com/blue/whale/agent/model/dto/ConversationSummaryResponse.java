package com.blue.whale.agent.model.dto;

/**
 * Conversation 摘要响应（IK2QBZ）。
 *
 * 实时按 conversation_messages 聚合计算，零持久化（不缓存摘要列）。messageCount 为已持久化消息总数；
 * firstUserPreview 为首条 user 消息截断 PREVIEW_MAX_LENGTH 字符；lastMessagePreview 为末条消息截断；
 * earliestAt / latestAt 为首末消息创建时间（ISO 本地时间）。字段经全局 SNAKE_CASE 策略输出。
 */
public record ConversationSummaryResponse(
        Long conversationId,
        Integer messageCount,
        String firstUserPreview,
        String lastMessagePreview,
        String earliestAt,
        String latestAt
) {}
