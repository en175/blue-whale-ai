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
public final class ToolRegistry {

    private final Map<ToolKey, ToolDefinition> tools;

    ToolRegistry(ObjectMapper objectMapper) {
        this.tools = Map.copyOf(registerDefaults(objectMapper));
    }

    public Optional<ToolDefinition> find(String toolId, int registryVersion) {
        if (toolId == null) {
            return Optional.empty();
        }
        return Optional.ofNullable(tools.get(new ToolKey(toolId, registryVersion)));
    }

    private Map<ToolKey, ToolDefinition> registerDefaults(ObjectMapper objectMapper) {
        Map<ToolKey, ToolDefinition> registry = new LinkedHashMap<>();
        registry.put(
                new ToolKey("list_canvas_nodes", 1),
                new ToolDefinition(
                        "list_canvas_nodes",
                        1,
                        "read",
                        RiskLevel.LOW,
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object",\
                                 "properties":{"limit":{"type":"integer","minimum":1,"maximum":200}},\
                                 "additionalProperties":false}"""),
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object"}"""),
                        parseBuiltinSchema(objectMapper, "{\"max_results\":200}"),
                        Set.of("tool_calling"),
                        null));
        registry.put(
                new ToolKey("read_canvas_node", 1),
                new ToolDefinition(
                        "read_canvas_node",
                        1,
                        "read",
                        RiskLevel.LOW,
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object",\
                                 "properties":{"node_id":{"type":"string","minLength":1}},\
                                 "required":["node_id"],\
                                 "additionalProperties":false}"""),
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object"}"""),
                        parseBuiltinSchema(objectMapper, "{}"),
                        Set.of("tool_calling"),
                        null));
        registry.put(
                new ToolKey("read_asset", 1),
                new ToolDefinition(
                        "read_asset",
                        1,
                        "read",
                        RiskLevel.LOW,
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object",\
                                 "properties":{"asset_id":{"type":"integer","minimum":1}},\
                                 "required":["asset_id"],\
                                 "additionalProperties":false}"""),
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object"}"""),
                        parseBuiltinSchema(objectMapper, "{}"),
                        Set.of("tool_calling"),
                        null));
        registry.put(
                new ToolKey("read_generation_job_status", 1),
                new ToolDefinition(
                        "read_generation_job_status",
                        1,
                        "read",
                        RiskLevel.LOW,
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object",\
                                 "properties":{"job_id":{"type":"integer","minimum":1}},\
                                 "required":["job_id"],\
                                 "additionalProperties":false}"""),
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object"}"""),
                        parseBuiltinSchema(objectMapper, "{}"),
                        Set.of("tool_calling"),
                        null));
        registry.put(
                new ToolKey("list_creative_skills", 1),
                new ToolDefinition(
                        "list_creative_skills",
                        1,
                        "read",
                        RiskLevel.LOW,
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object",\
                                 "additionalProperties":false}"""),
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object"}"""),
                        parseBuiltinSchema(objectMapper, "{}"),
                        Set.of("tool_calling"),
                        null));
        registry.put(
                new ToolKey("read_conversation_summary", 1),
                new ToolDefinition(
                        "read_conversation_summary",
                        1,
                        "read",
                        RiskLevel.LOW,
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object",\
                                 "additionalProperties":false}"""),
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object"}"""),
                        parseBuiltinSchema(objectMapper, "{}"),
                        Set.of("tool_calling"),
                        null));
        registry.put(
                new ToolKey("read_conversation_history", 1),
                new ToolDefinition(
                        "read_conversation_history",
                        1,
                        "read",
                        RiskLevel.LOW,
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object",\
                                 "properties":{"after":{"type":"integer","minimum":1},"limit":{"type":"integer","minimum":1,"maximum":100}},\
                                 "additionalProperties":false}"""),
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object"}"""),
                        parseBuiltinSchema(objectMapper, "{\"limit\":{\"max\":100}}"),
                        Set.of("tool_calling"),
                        null));
        registry.put(
                new ToolKey("create_image_generation_job", 1),
                new ToolDefinition(
                        "create_image_generation_job",
                        1,
                        "side_effect",
                        RiskLevel.MEDIUM,
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object",\
                                 "properties":{"prompt":{"type":"string","minLength":1},\
                                               "aspect_ratio":{"type":"string","enum":["1:1","16:9","9:16","4:3","3:4","2:3","3:2","21:9"]},\
                                               "reference_asset_ids":{"type":"array","maxItems":4,"items":{"type":"integer","minimum":1}},\
                                               "size":{"type":"string"},\
                                               "web_search":{"type":"boolean"}},\
                                 "required":["prompt"],\
                                 "additionalProperties":false}"""),
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object",\
                                 "properties":{"job_id":{"type":"integer"}}}"""),
                        parseBuiltinSchema(objectMapper, """
                                {"expected_output_count":{"min":1,"max":1},\
                                 "prompt":{"maxLength":2000}}"""),
                        Set.of("tool_calling"),
                        "image"));
        registry.put(
                new ToolKey("create_video_generation_job", 1),
                new ToolDefinition(
                        "create_video_generation_job",
                        1,
                        "side_effect",
                        RiskLevel.MEDIUM,
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object",\
                                 "properties":{"prompt":{"type":"string","minLength":1},\
                                               "aspect_ratio":{"type":"string","enum":["16:9","4:3","1:1","3:4","9:16","21:9"]},\
                                               "resolution":{"type":"string","enum":["480p","720p","1080p"]},\
                                               "duration":{"type":"integer","minimum":4,"maximum":15},\
                                               "reference_asset_ids":{"type":"array","maxItems":1,"items":{"type":"integer","minimum":1}}},\
                                 "required":["prompt","aspect_ratio","resolution","duration"],\
                                 "additionalProperties":false}"""),
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object",\
                                 "properties":{"job_id":{"type":"integer"}}}"""),
                        parseBuiltinSchema(objectMapper, """
                                {"expected_output_count":{"min":1,"max":1},\
                                 "prompt":{"maxLength":4000}}"""),
                        Set.of("tool_calling"),
                        "video"));
        registry.put(
                new ToolKey("request_user_input", 1),
                new ToolDefinition(
                        "request_user_input",
                        1,
                        "side_effect",
                        RiskLevel.LOW,
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object",\
                                 "properties":{"request_type":{"type":"string","enum":["creation_clarification"]},\
                                               "question":{"type":"string","minLength":1},\
                                               "resume_binding":{"type":"object","additionalProperties":true}},\
                                 "required":["request_type","question"],\
                                 "additionalProperties":false}"""),
                        parseBuiltinSchema(objectMapper, """
                                {"$schema":"https://json-schema.org/draft/2020-12/schema",\
                                 "type":"object"}"""),
                        parseBuiltinSchema(objectMapper, "{\"question\":{\"maxLength\":1000}}"),
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
