package com.blue.whale.agent.runtimebundle;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * 平台 Agent 可提议工具的程序注册表，是 Bundle 发布期 ToolGrant 校验的唯一权威。
 *
 * <p>取代退役的 {@code blue-whale.runtime-bundle.approved-tool-contracts} 配置字符串形态：
 * 工具以代码注册，生产环境不再因空配置而拒绝一切 grant。注册项以 {@code toolId + registryVersion}
 * 为主键查询；发布快照固化所引用工具的 {@code registryVersion}，运行中的 AgentRun 不因后续注册表
 * 变更而漂移。
 *
 * <p>本注册表是 Agent 可提议动作的目录，与 ADR-0038 按 mode 装配的生图 Provider 不是同一概念。
 */
@Component
final class ToolRegistry {

    private final Map<ToolKey, ToolDefinition> tools;

    ToolRegistry(ObjectMapper objectMapper) {
        this.tools = Map.copyOf(registerDefaults(objectMapper));
    }

    Optional<ToolDefinition> find(String toolId, int registryVersion) {
        if (toolId == null) {
            return Optional.empty();
        }
        return Optional.ofNullable(tools.get(new ToolKey(toolId, registryVersion)));
    }

    private Map<ToolKey, ToolDefinition> registerDefaults(ObjectMapper objectMapper) {
        Map<ToolKey, ToolDefinition> registry = new LinkedHashMap<>();
        registry.put(
                new ToolKey("canvas.read", 1),
                new ToolDefinition(
                        "canvas.read",
                        1,
                        "read",
                        RiskLevel.LOW,
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object",\
                                 "properties":{"limit":{"type":"integer","maximum":100}},\
                                 "additionalProperties":false}"""),
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object"}"""),
                        parseBuiltinSchema(objectMapper, "{\"max_results\":100}"),
                        Set.of("tool_calling"),
                        null));
        return registry;
    }

    private static JsonNode parseBuiltinSchema(ObjectMapper objectMapper, String content) {
        try {
            return objectMapper.readTree(content);
        } catch (Exception exception) {
            throw new IllegalStateException("工具注册表内置 Schema 不可读: " + content, exception);
        }
    }

    private record ToolKey(String toolId, int registryVersion) {
    }
}
