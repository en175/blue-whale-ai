package com.blue.whale.agent.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/**
 * 生成收件箱消息接纳请求（IK21O9）。
 *
 * @param clientMessageId       客户端消息 id（追踪/去重，最长 64）
 * @param content               消息正文（最长 4000）
 * @param replyToInputRequestId 回答的输入请求 id（可空）
 * @param conversationId        落点对话 id（可空，缺省落收件箱最新对话）
 */
public record InboxMessageRequest(
        @JsonProperty("client_message_id") @NotBlank @Size(max = 64) String clientMessageId,
        @NotBlank @Size(max = 4000) String content,
        @JsonProperty("reply_to_input_request_id") Long replyToInputRequestId,
        @JsonProperty("conversation_id") Long conversationId) {
}
