package com.blue.whale.agent.model.dto;

import java.util.List;

/**
 * Conversation 游标分页历史响应（IK2QBZ）。
 *
 * 供 Python Agent Worker 按需回溯当前 Run 绑定的对话历史。游标为 conversation_messages.sequence_no
 * 单调序号（与 Project SSE after= 数字游标哲学一致，非 base64 不透明）。items 按 sequence_no 升序；
 * nextCursor 为末条 sequence_no，hasMore=true 时客户端以其作下一页 after，否则停止翻页。
 * 字段经全局 SNAKE_CASE 策略输出为 snake_case（message_id / sequence_no / agent_run_id 等）。
 */
public record ConversationHistoryResponse(
        Long conversationId,
        List<MessageItem> items,
        Long nextCursor,
        Boolean hasMore
) {
    public record MessageItem(
            Long messageId,
            String role,
            String content,
            Integer sequenceNo,
            Long agentRunId
    ) {}
}
