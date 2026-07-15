package com.blue.whale.agent.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonFormat;

import java.time.Instant;

public record AssetAccessResponse(
        String url,
        @JsonProperty("expires_at")
        @JsonFormat(shape = JsonFormat.Shape.STRING)
        Instant expiresAt) {
}
