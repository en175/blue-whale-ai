package com.blue.whale.agent.model.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class AssetAccessResponseTest {

    @Test
    void serializesAbsoluteExpiryAsExpiresAt() throws Exception {
        Instant expiresAt = Instant.parse("2026-07-15T04:02:00Z");

        JsonNode json = new ObjectMapper().findAndRegisterModules().valueToTree(
                new AssetAccessResponse("https://tos.example/signed", expiresAt));

        assertThat(json.path("url").asText()).isEqualTo("https://tos.example/signed");
        assertThat(json.path("expires_at").asText()).isEqualTo("2026-07-15T04:02:00Z");
        assertThat(json.has("expiresAt")).isFalse();
    }
}
