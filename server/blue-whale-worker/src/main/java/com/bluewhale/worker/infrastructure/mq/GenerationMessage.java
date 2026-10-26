package com.bluewhale.worker.infrastructure.mq;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;

public record GenerationMessage(String jobId) {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static GenerationMessage parse(byte[] body, boolean digitGuard) {
        JsonNode jobId;
        try {
            JsonNode root = MAPPER.readTree(body);
            jobId = root != null && root.isObject() ? root.get("jobId") : null;
        } catch (IOException | RuntimeException e) {
            return null;
        }
        if (jobId == null || !jobId.isTextual()) {
            return null;
        }
        String id = jobId.textValue();
        if (id.isEmpty()) {
            return null;
        }
        if (digitGuard && !id.matches("\\d+")) {
            return null;
        }
        return new GenerationMessage(id);
    }

    public static String encode(String jobId) {
        try {
            return MAPPER.writeValueAsString(new GenerationMessage(jobId));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }
}
