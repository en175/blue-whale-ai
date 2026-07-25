package com.blue.whale.agent.model.dto;

public record AcceptConversationMessageResponse(Long messageId, Long agentRunId, long cursor) {
}
