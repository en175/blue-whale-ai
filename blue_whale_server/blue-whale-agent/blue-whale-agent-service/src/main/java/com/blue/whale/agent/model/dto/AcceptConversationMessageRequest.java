package com.blue.whale.agent.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

import java.util.List;

public record AcceptConversationMessageRequest(
        @JsonProperty("client_message_id") @NotBlank @Size(max = 64) String clientMessageId,
        @NotBlank @Size(max = 4000) String content,
        @JsonProperty("reply_to_input_request_id") Long replyToInputRequestId,
        @JsonProperty("conversation_id") Long conversationId,
        @JsonProperty("referenced_asset_ids") @Size(max = 10) List<Long> referencedAssetIds,
        @JsonProperty("forced_creative_skill_id")
        @Pattern(regexp = "^[a-z][a-z0-9_]{2,79}$") String forcedCreativeSkillId) {
}
