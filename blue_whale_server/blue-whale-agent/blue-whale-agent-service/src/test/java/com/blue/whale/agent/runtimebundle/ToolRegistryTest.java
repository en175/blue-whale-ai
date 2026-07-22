package com.blue.whale.agent.runtimebundle;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ToolRegistryTest {

    private final ToolRegistry registry = new ToolRegistry(new ObjectMapper());

    @Test
    void creativeContextToolsRegisteredAsReadOnly() {
        // IK2QC7：五个创作现场只读直接工具须在发布期注册表登记为只读（取代退役的 canvas.read 占位），
        // 否则 ToolGrant 发布校验拒绝、Worker 侧闭包恒为死分支，端到端不通。
        for (String toolId : List.of(
                "list_canvas_nodes", "read_canvas_node", "read_asset",
                "read_generation_job_status", "list_creative_skills")) {
            ToolDefinition def = registry.find(toolId, 1).orElseThrow();
            assertThat(def.effect()).isEqualTo("read");
            assertThat(def.riskLevel()).isEqualTo(RiskLevel.LOW);
            assertThat(def.generationCapabilityType()).isNull();
        }
    }

    @Test
    void readConversationToolsRegisteredAsReadOnly() {
        // IK2QBZ：两个对话读取直接工具须在发布期注册表登记为只读，否则 ToolGrant 发布校验
        // 拒绝、Worker 侧闭包恒为死分支，端到端不通。
        ToolDefinition summary = registry.find("read_conversation_summary", 1).orElseThrow();
        assertThat(summary.effect()).isEqualTo("read");
        assertThat(summary.riskLevel()).isEqualTo(RiskLevel.LOW);
        assertThat(summary.generationCapabilityType()).isNull();
        assertThat(summary.inputSchema().path("additionalProperties").asBoolean()).isFalse();

        ToolDefinition history = registry.find("read_conversation_history", 1).orElseThrow();
        assertThat(history.effect()).isEqualTo("read");
        assertThat(history.riskLevel()).isEqualTo(RiskLevel.LOW);
        assertThat(history.generationCapabilityType()).isNull();
        assertThat(history.inputSchema().path("properties").has("after")).isTrue();
        assertThat(history.inputSchema().path("properties").has("limit")).isTrue();
        assertThat(history.inputSchema().path("properties").path("limit").path("maximum").asInt())
                .isEqualTo(100);
        assertThat(history.constraints().path("limit").path("max").asInt()).isEqualTo(100);
    }

    @Test
    void createImageGenerationJobIsRegisteredAsFirstSideEffectTool() {
        ToolDefinition def = registry.find("create_image_generation_job", 1).orElseThrow();
        assertThat(def.effect()).isEqualTo("side_effect");
        assertThat(def.riskLevel()).isEqualTo(RiskLevel.MEDIUM);
        assertThat(def.generationCapabilityType()).isEqualTo("image");
        assertThat(def.inputSchema().path("properties").has("prompt")).isTrue();
        assertThat(def.inputSchema().path("properties").has("aspect_ratio")).isTrue();
        assertThat(def.inputSchema().path("properties").has("reference_asset_ids")).isTrue();
        assertThat(def.inputSchema().path("properties").has("size")).isTrue();
        assertThat(def.inputSchema().path("properties").has("web_search")).isTrue();
        assertThat(def.inputSchema().path("required").toString()).contains("prompt");
        assertThat(def.inputSchema().path("additionalProperties").asBoolean()).isFalse();
        assertThat(def.inputSchema().path("properties").path("aspect_ratio").path("enum").toString())
                .contains("1:1", "16:9", "9:16", "21:9");
        assertThat(def.constraints().has("expected_output_count")).isTrue();
    }
}
