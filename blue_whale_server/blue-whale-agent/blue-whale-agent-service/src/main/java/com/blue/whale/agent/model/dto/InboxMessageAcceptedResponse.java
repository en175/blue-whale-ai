package com.blue.whale.agent.model.dto;

/**
 * 生成收件箱消息接纳响应（IK21O9）。
 *
 * @param projectId      收件箱 project id
 * @param conversationId 落点对话 id
 * @param messageId      已接纳消息 id
 * @param agentRunId     已排队 AgentRun id
 * @param acceptedCursor 接纳游标（客户端 SSE 接续点）
 */
public record InboxMessageAcceptedResponse(Long projectId, Long conversationId, Long messageId,
                                           Long agentRunId, long acceptedCursor) {
}
