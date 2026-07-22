package com.blue.whale.agent;

import com.blue.whale.agent.mapper.AuditRecordMapper;
import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.entity.Project;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * IK3AH2（契约 §6.4）：只读资源证据落主 audit_records 的 fail-closed 集成测试。
 *
 * <p>独立测试类——{@code @MockBean AuditRecordMapper} 让 {@code append} 返 0（仿
 * {@link com.blue.whale.agent.service.governance.AuditFailClosedIT}），全局替换会污染共享 context，
 * 故隔离在独立类，避免影响 {@link ConversationAgentRunIT} 的合法 commit 路径。
 */
@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "volcengine.ark.base-url=https://ark.test.invalid",
        "blue-whale.agent-orchestrator.engine=fake",
        "blue-whale.agent-orchestrator.engine-version=1",
        "blue-whale.agent-orchestrator.adapter-schema-version=1"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BundleReadEvidenceAuditFailClosedIT {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ProjectMapper projectMapper;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private ObjectMapper objectMapper;
    @MockBean
    private AuditRecordMapper auditRecordMapper;

    @BeforeEach
    void cleanFacts() {
        jdbcTemplate.batchUpdate(
                "DELETE FROM audit_records",
                "DELETE FROM cost_reservations",
                "DELETE FROM cost_budget_locks",
                "DELETE FROM user_input_requests",
                "DELETE FROM run_commits",
                "DELETE FROM runtime_checkpoints",
                "DELETE FROM command_idempotency",
                "DELETE FROM message_asset_reference",
                "DELETE FROM conversation_messages",
                "DELETE FROM generation_job_outputs",
                "DELETE FROM generation_jobs",
                "DELETE FROM assets",
                "DELETE FROM agent_runs",
                "DELETE FROM conversations",
                "DELETE FROM outbox_messages",
                "DELETE FROM project_events",
                "DELETE FROM project_event_stream",
                "DELETE FROM project");
    }

    @Test
    void bundleEvidenceAuditFailureFailsClosed() throws Exception {
        // 证据审计写入失败 fail closed，与 commit 共生共灭，回滚整个提交。
        Project project = new Project().setOwnerId(10L).setName("evidence-fail-closed");
        projectMapper.insert(project);
        long runId = postMessage(project.getId(), "evidence-fail-key", "生成一张蓝鲸海报")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String evidence = "\"bundle_evidence\":[{\"resource_id\":\"skill_root\",\"revision\":1,"
                + "\"content_digest\":\"sha256:fail\",\"token_estimate\":16,\"origin\":\"on_demand\"}]";

        // @MockBean AuditRecordMapper.append 默认返 0：persist 抛 IllegalStateException 触发
        // @Transactional 回滚整个 commit，无任何 commit 事实落库（异常经 MVC 包成 NestedServletException）。
        assertThatThrownBy(() -> mockMvc.perform(post("/internal/agent-runs/{id}/commits", runId)
                        .header("X-Worker-Id", "fake-worker-1")
                        .contentType("application/json")
                        .content(commitBodyWithEvidence(project.getId(), work, evidence))))
                .hasCauseInstanceOf(IllegalStateException.class);

        assertThat(count("runtime_checkpoints", "agent_run_id", runId)).isZero();
        assertThat(count("run_commits", "agent_run_id", runId)).isZero();
        assertThat(count("generation_jobs", "agent_run_id", runId)).isZero();
        // commit 的 assistant 消息已回滚，仅剩 postMessage 的 user 消息。
        assertThat(count("conversation_messages", "project_id", project.getId())).isEqualTo(1);
    }

    private JsonNode postMessage(Long projectId, String idempotencyKey, String content) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/projects/{id}/conversation/messages", projectId)
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType("application/json")
                        .content("{\"client_message_id\":\"client-" + idempotencyKey
                                + "\",\"content\":\"" + content + "\"}"))
                .andExpect(status().isAccepted())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private JsonNode claim(long expectedRunId) throws Exception {
        MvcResult result = mockMvc.perform(post("/internal/agent-runs/claim")
                        .header("X-Worker-Id", "fake-worker-1")
                        .header("X-Orchestrator-Engine", "fake"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.agent_run_id").value(expectedRunId))
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private String commitBodyWithEvidence(Long projectId, JsonNode work, String bundleEvidenceJson) {
        String base = "{"
                + "\"commit_id\":\"commit-evidence\","
                + "\"project_id\":" + projectId + ","
                + "\"user_id\":10,"
                + "\"expected_run_version\":" + work.path("run_version").asInt() + ","
                + "\"fencing_token\":" + work.path("fencing_token").asLong() + ","
                + "\"engine\":\"fake\","
                + "\"engine_version\":\"1\","
                + "\"adapter_schema_version\":1,"
                + "\"visible_text\":\"已接纳，正在生成图片。\","
                + "\"checkpoint\":{\"opaque_payload\":{\"step\":\"proposed\"}},"
                + "\"actions\":[{\"action_id\":\"action-1\",\"tool_id\":\"create_image_generation_job\","
                + "\"registry_version\":1,"
                + "\"arguments\":{\"prompt\":\"蓝鲸海报\",\"aspect_ratio\":\"1:1\"}}]}";
        if (bundleEvidenceJson == null || bundleEvidenceJson.isBlank()) {
            return base;
        }
        return base.replace("]}", "]," + bundleEvidenceJson + "}");
    }

    private long count(String table, String column, Long value) {
        Long result = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE " + column + " = ?", Long.class, value);
        return result == null ? 0L : result;
    }
}
