package com.blue.whale.agent.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@link CreativeSkillVersionsProjection} 单测：DB JSON 字符串 → wire 数组投影。
 *
 * <p>契约 §3：activated_creative_skill_versions 始终为数组。CCS / SnapshotService / AgentRunWorkerService
 * 三处共用本投影，这里锁定解析行为（null/blank → 空数组；合法 JSON → 数组节点；损坏 → fail-closed）。
 */
class CreativeSkillVersionsProjectionTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void nullOrBlankReturnsEmptyArrayNode() {
        for (String value : new String[]{null, "", "   "}) {
            JsonNode result = CreativeSkillVersionsProjection.toArray(objectMapper, value);
            assertThat(result.isArray()).isTrue();
            assertThat(result.size()).isZero();
        }
    }

    @Test
    void parsesJsonArrayToTreeNode() {
        JsonNode array = CreativeSkillVersionsProjection.toArray(objectMapper,
                "[{\"creative_skill_id\":\"cs_a\",\"source\":\"forced_use\"}]");
        assertThat(array.isArray()).isTrue();
        assertThat(array.get(0).path("creative_skill_id").asText()).isEqualTo("cs_a");
        assertThat(array.get(0).path("source").asText()).isEqualTo("forced_use");
    }

    @Test
    void corruptedJsonThrowsIllegalState() {
        assertThatThrownBy(() -> CreativeSkillVersionsProjection.toArray(objectMapper, "[not json"))
                .isInstanceOf(IllegalStateException.class);
    }
}
