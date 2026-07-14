package com.blue.whale.agent.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

public record AcceptConversationMessageRequest(
        @JsonProperty("client_message_id") @NotBlank @Size(max = 64) String clientMessageId,
        @NotBlank @Size(max = 4000) String content,
        @JsonProperty("reply_to_input_request_id") Long replyToInputRequestId) {
}
