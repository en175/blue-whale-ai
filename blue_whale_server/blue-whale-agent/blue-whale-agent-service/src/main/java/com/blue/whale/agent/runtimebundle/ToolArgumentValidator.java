package com.blue.whale.agent.runtimebundle;

import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * 注册表驱动的工具参数值校验器（IK3AH2）：以 {@link ToolDefinition#inputSchema()} /
 * {@link ToolDefinition#constraints()} 为单一事实源，替代 commit 路径既有手工白名单。
 *
 * <p>与 {@link ToolGrantScope#schemaNoWider} 正交：后者判定 grant「不宽于」注册表（发布期收窄铁闸，
 * 不校验运行时值），本类在 commit 接纳路径对 Agent 实际提交的 arguments 做值校验。覆盖关键 JSON Schema
 * 关键字（type/enum/const/minLength/maxLength/minimum/maximum/exclusiveMin/Max/minItems/maxItems/
 * items 递归/required/properties 递归/additionalProperties:false）；constraints 形状为
 * {@code {maxLength/minLength/min/max}}，仅对 arguments 中存在的顶层 key 生效——
 * {@code prompt.maxLength:2000(image)/4000(video)} 由此执行。
 *
 * <p>违约抛 {@link GlobalException}({@code AGENT_ACTION_REJECTED})，与 commit 既有失败语义一致，
 * 由 {@code validateAction} 的 try/catch 统一 fail-closed。
 */
@Component
public final class ToolArgumentValidator {

    private final ObjectMapper objectMapper;

    ToolArgumentValidator(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void validate(Map<String, Object> arguments, JsonNode inputSchema, JsonNode constraints) {
        if (inputSchema == null || !inputSchema.isObject()) {
            return;
        }
        validateObject(arguments, inputSchema);
        if (constraints != null && constraints.isObject()) {
            var fields = constraints.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> entry = fields.next();
                if (entry.getValue().isObject() && arguments.containsKey(entry.getKey())) {
                    validateConstraints(arguments.get(entry.getKey()), entry.getValue());
                }
            }
        }
    }

    private void validateObject(Map<?, ?> value, JsonNode schema) {
        JsonNode required = schema.path("required");
        if (required.isArray()) {
            for (JsonNode req : required) {
                if (!value.containsKey(req.asText())) {
                    throw rejected();
                }
            }
        }
        JsonNode properties = schema.path("properties");
        boolean additional = schema.path("additionalProperties").asBoolean(true);
        if (!additional && properties.isObject()) {
            for (Object key : value.keySet()) {
                if (!properties.has(String.valueOf(key))) {
                    throw rejected();
                }
            }
        }
        if (properties.isObject()) {
            for (Object key : value.keySet()) {
                JsonNode propSchema = properties.path(String.valueOf(key));
                if (propSchema.isObject()) {
                    validateValue(value.get(key), propSchema);
                }
            }
        }
    }

    private void validateValue(Object value, JsonNode schema) {
        if (value == null) {
            return;
        }
        JsonNode type = schema.path("type");
        if (type.isTextual()) {
            checkType(value, type.asText());
        }
        JsonNode enumNode = schema.path("enum");
        if (enumNode.isArray() && !contains(enumNode, value)) {
            throw rejected();
        }
        JsonNode constNode = schema.path("const");
        if (!constNode.isMissingNode() && !constNode.equals(objectMapper.valueToTree(value))) {
            throw rejected();
        }
        if (value instanceof String s) {
            checkStringLength(s, schema);
        } else if (value instanceof Number n) {
            checkNumberRange(n, schema);
        } else if (value instanceof List<?> list) {
            checkArray(list, schema);
        } else if (value instanceof Map<?, ?> map) {
            validateObject(map, schema);
        }
    }

    private void checkType(Object value, String type) {
        switch (type) {
            case "string" -> require(value instanceof String);
            case "boolean" -> require(value instanceof Boolean);
            case "integer" -> require(isInteger(value));
            case "number" -> require(value instanceof Number);
            case "array" -> require(value instanceof List<?>);
            case "object" -> require(value instanceof Map<?, ?>);
            default -> { }
        }
    }

    private static boolean isInteger(Object value) {
        if (!(value instanceof Number n)) {
            return false;
        }
        double d = n.doubleValue();
        return !Double.isInfinite(d) && d == Math.floor(d);
    }

    private boolean contains(JsonNode enumNode, Object value) {
        JsonNode valueNode = objectMapper.valueToTree(value);
        for (JsonNode opt : enumNode) {
            if (opt.equals(valueNode)) {
                return true;
            }
        }
        return false;
    }

    private void checkStringLength(String s, JsonNode schema) {
        int len = s.codePointCount(0, s.length());
        JsonNode min = schema.path("minLength");
        if (min.isNumber() && len < min.asInt()) {
            throw rejected();
        }
        JsonNode max = schema.path("maxLength");
        if (max.isNumber() && len > max.asInt()) {
            throw rejected();
        }
    }

    private void checkNumberRange(Number n, JsonNode schema) {
        BigDecimal v = new BigDecimal(n.toString());
        JsonNode min = schema.path("minimum");
        if (min.isNumber() && v.compareTo(decimal(min)) < 0) {
            throw rejected();
        }
        JsonNode max = schema.path("maximum");
        if (max.isNumber() && v.compareTo(decimal(max)) > 0) {
            throw rejected();
        }
        JsonNode exclMin = schema.path("exclusiveMinimum");
        if (exclMin.isNumber() && v.compareTo(decimal(exclMin)) <= 0) {
            throw rejected();
        }
        JsonNode exclMax = schema.path("exclusiveMaximum");
        if (exclMax.isNumber() && v.compareTo(decimal(exclMax)) >= 0) {
            throw rejected();
        }
    }

    private void checkArray(List<?> list, JsonNode schema) {
        JsonNode minItems = schema.path("minItems");
        if (minItems.isNumber() && list.size() < minItems.asInt()) {
            throw rejected();
        }
        JsonNode maxItems = schema.path("maxItems");
        if (maxItems.isNumber() && list.size() > maxItems.asInt()) {
            throw rejected();
        }
        JsonNode items = schema.path("items");
        if (items.isObject()) {
            for (Object item : list) {
                validateValue(item, items);
            }
        }
    }

    private void validateConstraints(Object value, JsonNode constraints) {
        if (value instanceof String s) {
            int len = s.codePointCount(0, s.length());
            JsonNode maxLen = constraints.path("maxLength");
            if (maxLen.isNumber() && len > maxLen.asInt()) {
                throw rejected();
            }
            JsonNode minLen = constraints.path("minLength");
            if (minLen.isNumber() && len < minLen.asInt()) {
                throw rejected();
            }
        } else if (value instanceof Number n) {
            BigDecimal v = new BigDecimal(n.toString());
            JsonNode min = constraints.path("min");
            if (min.isNumber() && v.compareTo(decimal(min)) < 0) {
                throw rejected();
            }
            JsonNode max = constraints.path("max");
            if (max.isNumber() && v.compareTo(decimal(max)) > 0) {
                throw rejected();
            }
        }
    }

    private static BigDecimal decimal(JsonNode node) {
        return node.isNumber() ? node.decimalValue() : new BigDecimal(node.asText());
    }

    private static void require(boolean condition) {
        if (!condition) {
            throw rejected();
        }
    }

    private static GlobalException rejected() {
        return new GlobalException(SystemCode.AGENT_ACTION_REJECTED_CODE,
                SystemCode.AGENT_ACTION_REJECTED.getMsg());
    }
}
