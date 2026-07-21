package com.blue.whale.agent.runtimebundle;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public final class RuntimeBundleDigests {

    private final ObjectMapper objectMapper;

    public RuntimeBundleDigests(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    String content(String value) {
        return sha256(value.getBytes(StandardCharsets.UTF_8));
    }

    public String canonicalJson(JsonNode value) {
        try {
            return sha256(objectMapper.writeValueAsBytes(canonicalize(value)));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Runtime Bundle JSON 无法规范化", exception);
        }
    }

    private JsonNode canonicalize(JsonNode value) {
        if (value.isObject()) {
            ObjectNode sorted = objectMapper.createObjectNode();
            List<String> fields = new ArrayList<>();
            value.fieldNames().forEachRemaining(fields::add);
            fields.stream().sorted(Comparator.naturalOrder())
                    .forEach(field -> sorted.set(field, canonicalize(value.get(field))));
            return sorted;
        }
        if (value.isArray()) {
            ArrayNode array = objectMapper.createArrayNode();
            value.forEach(element -> array.add(canonicalize(element)));
            return array;
        }
        return value.deepCopy();
    }

    private String sha256(byte[] value) {
        try {
            return "sha256:" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("JVM 缺少 SHA-256", exception);
        }
    }
}
