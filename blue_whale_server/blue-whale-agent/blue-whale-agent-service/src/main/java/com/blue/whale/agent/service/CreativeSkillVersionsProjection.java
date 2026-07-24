package com.blue.whale.agent.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Creative Skill 版本钉住数据（DB JSON 字符串）→ wire 数组的统一投影。
 *
 * <p>契约 §3：{@code activated_creative_skill_versions} 始终为数组（0/1 项），不得缺省为 null，
 * 也不得把 DB 中持久化的 JSON 字符串原样下发。ConversationCommandService.runPayload、
 * SnapshotService 的 AgentRunDto 与 AgentRunWorkerService 三处共用本投影，防止形状漂移。
 */
public final class CreativeSkillVersionsProjection {

    private CreativeSkillVersionsProjection() {
    }

    /**
     * 把 DB 中以 JSON 字符串持久化的 {@code activated_creative_skill_versions} 解析为 wire 数组节点。
     *
     * <p>null/blank 返回空数组；损坏的 JSON 抛 {@link IllegalStateException}（fail-closed），
     * 与既有 AgentRunWorkerService 行为一致，不静默降级。
     */
    public static JsonNode toArray(ObjectMapper objectMapper, String value) {
        if (value == null || value.isBlank()) {
            return objectMapper.createArrayNode();
        }
        try {
            return objectMapper.readTree(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("AgentRun 的 Creative Skill 版本钉住数据已损坏", exception);
        }
    }
}
