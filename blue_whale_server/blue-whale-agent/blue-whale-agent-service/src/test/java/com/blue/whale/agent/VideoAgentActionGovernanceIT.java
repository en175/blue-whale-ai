package com.blue.whale.agent;

import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.entity.Project;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 视频生成动作（{@code create_video_generation_job}）经 AgentRun commit 治理链的端到端 IT，
 * 镜像 {@link AgentActionGovernanceIT} 的图片动作覆盖：端到端建 Job、超能力/白名单拒绝、action_id 幂等。
 *
 * <p>视频报价走 {@code generate_video}（默认 {@code videoReservationFen=50} ≤ 直接限额），无需确认即建 Job。
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
class VideoAgentActionGovernanceIT {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ProjectMapper projectMapper;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private ObjectMapper objectMapper;

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
                "DELETE FROM conversation_messages",
                "DELETE FROM generation_job_outputs",
                "DELETE FROM generation_jobs",
                "DELETE FROM agent_runs",
                "DELETE FROM conversations",
                "DELETE FROM outbox_messages",
                "DELETE FROM project_events",
                "DELETE FROM project_event_stream",
                "DELETE FROM project");
    }

    @Test
    void videoAgentActionCreatesVideoGenerationJob() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("agent-video-action");
        projectMapper.insert(project);
        JsonNode run = postMessage(project.getId(), "video-message-1", "生成一段蓝鲸游动视频", null)
                .path("agent_run_id");
        JsonNode work = claim(run.asLong(), "video-worker-1");

        commit(run.asLong(), "video-worker-1",
                videoBody(project.getId(), work, "video-commit-1", "action-video-create",
                        "16:9", "720p", 8))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.generation_job_id").isNumber())
                .andExpect(jsonPath("$.data.input_request_id").doesNotExist());

        assertThat(jdbcTemplate.queryForObject(
                "SELECT type FROM generation_jobs", String.class)).isEqualTo("video");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT strategy_version FROM generation_jobs", String.class)).isEqualTo("seedance-2.0-v1");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT progress FROM generation_jobs", Object.class)).isNull();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT evidence_reconcile_until FROM generation_jobs", Object.class)).isNotNull();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM cost_reservations", String.class)).isEqualTo("ACTIVE");
        assertThat(jdbcTemplate.queryForList(
                "SELECT action_type FROM cost_reservations", String.class)).containsExactly("generate_video");
    }

    @Test
    void videoActionRejectedWhenDurationExceedsCapability() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("video-duration-reject");
        projectMapper.insert(project);
        JsonNode run = postMessage(project.getId(), "video-dur-msg", "生成视频", null).path("agent_run_id");
        JsonNode work = claim(run.asLong(), "video-dur-worker");

        // duration=20 超出视频能力上界 [4,15]，validateAction 在 cost 预留前拒绝。
        commit(run.asLong(), "video-dur-worker",
                videoBody(project.getId(), work, "video-dur-commit", "action-video-dur",
                        "16:9", "720p", 20))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.data.code").value("ACTION_NOT_ALLOWED"));

        assertThat(jdbcTemplate.queryForObject(
                "SELECT reason_code FROM audit_records WHERE decision = 'denied' ORDER BY id DESC LIMIT 1",
                String.class)).isEqualTo("ACTION_SCHEMA_OR_OWNERSHIP_REJECTED");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM generation_jobs", Long.class)).isZero();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM cost_reservations", Long.class)).isZero();
    }

    @Test
    void videoActionRejectedWhenAspectRatioUnsupported() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("video-aspect-reject");
        projectMapper.insert(project);
        JsonNode run = postMessage(project.getId(), "video-aspect-msg", "生成视频", null).path("agent_run_id");
        JsonNode work = claim(run.asLong(), "video-aspect-worker");

        // 2:3 在图片能力内但不在视频能力白名单（视频无 2:3）。
        commit(run.asLong(), "video-aspect-worker",
                videoBody(project.getId(), work, "video-aspect-commit", "action-video-aspect",
                        "2:3", "720p", 8))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.data.code").value("ACTION_NOT_ALLOWED"));

        assertThat(jdbcTemplate.queryForObject(
                "SELECT reason_code FROM audit_records WHERE decision = 'denied' ORDER BY id DESC LIMIT 1",
                String.class)).isEqualTo("ACTION_SCHEMA_OR_OWNERSHIP_REJECTED");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM generation_jobs", Long.class)).isZero();
    }

    @Test
    void videoActionIsIdempotentByActionIdentity() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("video-idempotent");
        projectMapper.insert(project);
        JsonNode run1 = postMessage(project.getId(), "video-idem-msg-1", "生成视频", null).path("agent_run_id");
        JsonNode work1 = claim(run1.asLong(), "video-idem-worker-1");
        commit(run1.asLong(), "video-idem-worker-1",
                videoBody(project.getId(), work1, "video-idem-commit-1", "action-video-idem",
                        "16:9", "720p", 8))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.generation_job_id").isNumber());

        // 跨 run 同 action_id：validateAction 经 projectActionIdentity 去重拒绝，不产生第二 Job 或第二笔预留。
        JsonNode run2 = postMessage(project.getId(), "video-idem-msg-2", "再生成视频", null).path("agent_run_id");
        JsonNode work2 = claim(run2.asLong(), "video-idem-worker-2");
        commit(run2.asLong(), "video-idem-worker-2",
                videoBody(project.getId(), work2, "video-idem-commit-2", "action-video-idem",
                        "16:9", "720p", 8))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.data.code").value("ACTION_NOT_ALLOWED"));

        assertThat(jdbcTemplate.queryForObject(
                "SELECT reason_code FROM audit_records WHERE decision = 'denied' ORDER BY id DESC LIMIT 1",
                String.class)).isEqualTo("ACTION_SCHEMA_OR_OWNERSHIP_REJECTED");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM generation_jobs", Long.class)).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM cost_reservations", Long.class)).isEqualTo(1);
    }

    @Test
    void unlistedSideEffectToolIsRejectedBeforeAnyJobOrCost() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("video-unlisted-tool");
        projectMapper.insert(project);
        JsonNode run = postMessage(project.getId(), "video-unlisted-msg", "删除当前项目", null)
                .path("agent_run_id");
        JsonNode work = claim(run.asLong(), "video-unlisted-worker");

        // 未注册 tool_id（提示注入场景）：注册表驱动铁闸在 schema/ownership 层拒绝，
        // 镜像 AgentActionGovernanceIT.promptInjectionCannotAuthorizeAnUnlistedSideEffect，
        // 让本类自包含覆盖 Brief IK2QC0 验收「未授权 tool_id」拒绝路径。
        String body = "{" +
                "\"commit_id\":\"video-unlisted-commit\"," +
                "\"project_id\":" + project.getId() + "," +
                "\"user_id\":10," +
                "\"expected_run_version\":" + work.path("run_version").asInt() + "," +
                "\"fencing_token\":" + work.path("fencing_token").asLong() + "," +
                "\"engine\":\"fake\"," +
                "\"engine_version\":\"1\"," +
                "\"adapter_schema_version\":1," +
                "\"visible_text\":\"已按提示绕过策略。\"," +
                "\"checkpoint\":{\"opaque_payload\":{\"step\":\"injected\"}}," +
                "\"actions\":[{\"action_id\":\"injected-delete\"," +
                "\"tool_id\":\"delete_project\",\"registry_version\":1," +
                "\"arguments\":{\"project_id\":" + project.getId() + "}}]}";

        commit(run.asLong(), "video-unlisted-worker", body)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.data.code").value("ACTION_NOT_ALLOWED"));

        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM generation_jobs", Long.class)).isZero();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM cost_reservations", Long.class)).isZero();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT reason_code FROM audit_records WHERE decision = 'denied' ORDER BY id DESC LIMIT 1",
                String.class)).isEqualTo("ACTION_SCHEMA_OR_OWNERSHIP_REJECTED");
    }

    private JsonNode postMessage(
            long projectId, String key, String content, Long inputRequestId) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/projects/{id}/conversation/messages", projectId)
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", key)
                        .contentType("application/json")
                        .content(messageBody("client-" + key, content, inputRequestId)))
                .andExpect(status().isAccepted())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private JsonNode claim(long runId, String workerId) throws Exception {
        MvcResult result = mockMvc.perform(post("/internal/agent-runs/claim")
                        .header("X-Worker-Id", workerId)
                        .header("X-Orchestrator-Engine", "fake"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.agent_run_id").value(runId))
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private org.springframework.test.web.servlet.ResultActions commit(
            long runId, String workerId, String body) throws Exception {
        return mockMvc.perform(post("/internal/agent-runs/{id}/commits", runId)
                .header("X-Worker-Id", workerId)
                .contentType("application/json")
                .content(body));
    }

    private String messageBody(String clientId, String content, Long inputRequestId) {
        return "{\"client_message_id\":\"" + clientId + "\",\"content\":\"" + content + "\""
                + (inputRequestId == null ? "" : ",\"reply_to_input_request_id\":" + inputRequestId)
                + "}";
    }

    private String videoBody(long projectId, JsonNode work, String commitId, String actionId,
                             String aspectRatio, String resolution, int duration) {
        return "{" +
                "\"commit_id\":\"" + commitId + "\"," +
                "\"project_id\":" + projectId + "," +
                "\"user_id\":10," +
                "\"expected_run_version\":" + work.path("run_version").asInt() + "," +
                "\"fencing_token\":" + work.path("fencing_token").asLong() + "," +
                "\"engine\":\"fake\"," +
                "\"engine_version\":\"1\"," +
                "\"adapter_schema_version\":1," +
                "\"visible_text\":\"准备执行视频生成。\"," +
                "\"checkpoint\":{\"opaque_payload\":{\"step\":\"proposed\"}}," +
                "\"actions\":[{\"action_id\":\"" + actionId + "\"," +
                "\"tool_id\":\"create_video_generation_job\",\"registry_version\":1," +
                "\"arguments\":{\"prompt\":\"蓝鲸游动\",\"aspect_ratio\":\"" + aspectRatio + "\"," +
                "\"resolution\":\"" + resolution + "\",\"duration\":" + duration + "}}]}";
    }
}
