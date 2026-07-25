package com.blue.whale.agent.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record AssistantMessageStreamResponse(
        @JsonProperty("stream_id") String streamId,
        @JsonProperty("message_id") Long messageId,
        String status,
        @JsonProperty("last_sequence_no") Integer lastSequenceNo,
        @JsonProperty("released_sequence_no") Integer releasedSequenceNo,
        Long cursor) {
}
