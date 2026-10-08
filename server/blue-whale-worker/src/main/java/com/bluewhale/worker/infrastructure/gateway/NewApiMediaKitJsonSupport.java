package com.bluewhale.worker.infrastructure.gateway;
import com.bluewhale.common.http.NewApiHttpSupport;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.MediaType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

final class NewApiMediaKitJsonSupport {

    private static final Logger log = LoggerFactory.getLogger(NewApiMediaKitJsonSupport.class);

    static final ObjectMapper JSON = new ObjectMapper();

    static final MediaType JSON_TYPE = MediaType.get("application/json");

    private NewApiMediaKitJsonSupport() {}

    static JsonNode unwrapData(JsonNode parsed) {
        return parsed.has("data") && parsed.get("data").isObject() ? parsed.get("data") : parsed;
    }

    static String extractUpstreamMessage(String rawText) {
        try {
            JsonNode parsed = JSON.readTree(rawText);
            for (JsonNode node : new JsonNode[] {unwrapData(parsed), parsed}) {
                JsonNode message = node.path("error").path("message");
                if (!message.isTextual() || message.asText().isEmpty()) {
                    message = node.path("message");
                }
                if (message.isTextual() && !message.asText().isEmpty()) {
                    return truncate(message.asText());
                }
            }
        } catch (Exception e) {
            log.debug("上游错误 body 非法 JSON，回退原文截断: {}", e.getMessage());
        }
        return "";
    }

    static String textOrNull(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return (v != null && v.isTextual()) ? v.asText() : null;
    }

    static String truncate(String text) {
        return text.length() > 300 ? text.substring(0, 300) + "…" : text;
    }

    static String encodePath(String value) {
        return java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8);
    }
}
