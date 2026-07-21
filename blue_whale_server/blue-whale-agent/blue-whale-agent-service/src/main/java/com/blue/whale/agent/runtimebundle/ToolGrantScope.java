package com.blue.whale.agent.runtimebundle;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * 平台工具 grant 收窄铁闸：判定 ToolGrant 的 argumentSchema / constraints 是否不宽于
 * 注册表 {@link ToolDefinition} 的平台上界。发布期 {@link RuntimeBundleValidator} 与 commit
 * 运行时服务端复验共用同一逻辑，行为逐字保留，不重写。
 */
@Component
public final class ToolGrantScope {

    private static final Set<String> PROVABLE_SCHEMA_FIELDS = Set.of(
            "$schema", "type", "const", "format", "pattern", "enum", "minimum",
            "exclusiveMinimum", "minLength", "maximum", "exclusiveMaximum", "maxLength",
            "required", "additionalProperties", "properties");

    private final RuntimeBundleDigests digests;

    ToolGrantScope(RuntimeBundleDigests digests) {
        this.digests = digests;
    }

    public boolean schemaNoWider(JsonNode requested, JsonNode approved) {
        if (digests.canonicalJson(requested).equals(digests.canonicalJson(approved))) {
            return true;
        }
        if (!requested.isObject() || !approved.isObject()) {
            return false;
        }
        if (hasUnprovedSchemaDifference(requested, approved)
                || hasUnprovedSchemaDifference(approved, requested)) {
            return false;
        }
        for (String exactField : Set.of("$schema", "type", "const", "format", "pattern")) {
            if (approved.has(exactField) && !approved.path(exactField).equals(requested.path(exactField))) {
                return false;
            }
        }
        if (!enumIsSubset(requested.path("enum"), approved.path("enum"))) {
            return false;
        }
        if (!lowerBoundIsNarrower(requested, approved, "minimum")
                || !lowerBoundIsNarrower(requested, approved, "exclusiveMinimum")
                || !lowerBoundIsNarrower(requested, approved, "minLength")
                || !upperBoundIsNarrower(requested, approved, "maximum")
                || !upperBoundIsNarrower(requested, approved, "exclusiveMaximum")
                || !upperBoundIsNarrower(requested, approved, "maxLength")) {
            return false;
        }
        Set<String> requestedRequired = textValues(requested.path("required"));
        if (!requestedRequired.containsAll(textValues(approved.path("required")))) {
            return false;
        }
        boolean approvedAllowsAdditional = approved.path("additionalProperties").asBoolean(true);
        boolean requestedAllowsAdditional = requested.path("additionalProperties").asBoolean(true);
        if (!approvedAllowsAdditional && requestedAllowsAdditional) {
            return false;
        }
        JsonNode approvedProperties = approved.path("properties");
        JsonNode requestedProperties = requested.path("properties");
        if (approvedProperties.isObject()) {
            var fields = approvedProperties.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                if (requestedProperties.has(field.getKey())) {
                    if (!schemaNoWider(requestedProperties.path(field.getKey()), field.getValue())) {
                        return false;
                    }
                } else if (requestedAllowsAdditional) {
                    return false;
                }
            }
        }
        if (!approvedAllowsAdditional && requestedProperties.isObject()) {
            var requestedFields = requestedProperties.fieldNames();
            while (requestedFields.hasNext()) {
                if (!approvedProperties.has(requestedFields.next())) {
                    return false;
                }
            }
        }
        return true;
    }

    public boolean constraintsNoWider(JsonNode requested, JsonNode approved) {
        if (digests.canonicalJson(requested).equals(digests.canonicalJson(approved))) {
            return true;
        }
        if (!requested.isObject() || !approved.isObject()) {
            return false;
        }
        var requestedFields = requested.fieldNames();
        while (requestedFields.hasNext()) {
            if (!approved.has(requestedFields.next())) {
                return false;
            }
        }
        var fields = approved.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> field = fields.next();
            JsonNode requestedValue = requested.path(field.getKey());
            JsonNode approvedValue = field.getValue();
            if (requestedValue.isMissingNode()) {
                return false;
            }
            if (approvedValue.isObject()) {
                if (!constraintsNoWider(requestedValue, approvedValue)) {
                    return false;
                }
            } else if (approvedValue.isNumber() && requestedValue.isNumber()) {
                boolean lowerBound = field.getKey().toLowerCase().startsWith("min");
                int comparison = requestedValue.decimalValue().compareTo(approvedValue.decimalValue());
                if ((lowerBound && comparison < 0) || (!lowerBound && comparison > 0)) {
                    return false;
                }
            } else if (approvedValue.isArray() && requestedValue.isArray()) {
                for (JsonNode item : requestedValue) {
                    if (!java.util.stream.StreamSupport.stream(approvedValue.spliterator(), false)
                            .anyMatch(item::equals)) {
                        return false;
                    }
                }
            } else if (!approvedValue.equals(requestedValue)) {
                return false;
            }
        }
        return true;
    }

    private boolean hasUnprovedSchemaDifference(JsonNode source, JsonNode counterpart) {
        var fields = source.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> field = fields.next();
            if (!PROVABLE_SCHEMA_FIELDS.contains(field.getKey())
                    && !field.getValue().equals(counterpart.path(field.getKey()))) {
                return true;
            }
        }
        return false;
    }

    private boolean enumIsSubset(JsonNode requested, JsonNode approved) {
        if (!approved.isArray()) {
            return true;
        }
        if (!requested.isArray()) {
            return false;
        }
        for (JsonNode item : requested) {
            if (!java.util.stream.StreamSupport.stream(approved.spliterator(), false)
                    .anyMatch(item::equals)) {
                return false;
            }
        }
        return true;
    }

    private boolean lowerBoundIsNarrower(JsonNode requested, JsonNode approved, String field) {
        return !approved.has(field)
                || requested.has(field)
                && requested.path(field).decimalValue().compareTo(approved.path(field).decimalValue()) >= 0;
    }

    private boolean upperBoundIsNarrower(JsonNode requested, JsonNode approved, String field) {
        return !approved.has(field)
                || requested.has(field)
                && requested.path(field).decimalValue().compareTo(approved.path(field).decimalValue()) <= 0;
    }

    private Set<String> textValues(JsonNode array) {
        Set<String> result = new HashSet<>();
        array.forEach(value -> result.add(value.asText()));
        return result;
    }
}
