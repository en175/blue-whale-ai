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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 创作澄清（creation_clarification）输入请求契约测试（IK1NRW / ADR-0036）。
 *
 * <p>覆盖 OrchestratorPort 提议接纳、互斥校验、Snapshot 活动请求可见性、自然语言回答恢复、
 * 以及 AgentRun 聚合事件（requested/answered），与成本确认（{@link AgentActionGovernanceIT}）
 * 并存且语义互不污染。
 */
@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "volcengine.ark.base-url=https://ark.test.invalid",
        "blue-whale.agent-orchestrator.engine=fake",
        "blue-whale.agent-orchestrator.engine-version=1",
        "blue-whale.agent-orchestrator.adapter-schema-version=1",
        "blue-whale.cost-control.image-reservation-fen=250"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CreationClarificationIT {

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
    void workerProposalIsAcceptedAndAgentRunAwaitsClarification() throws Exception {
        Project project = newProject();
        JsonNode firstRun = postMessage(project.getId(), "msg-1", "generate a whale poster", null)
                .path("agent_run_id");
        JsonNode work = claim(firstRun.asLong(), "worker-1");

        MvcResult result = commit(firstRun.asLong(), "worker-1",
                        clarificationCommitBody(project.getId(), work, "commit-1", "Which style do you want?"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.input_request_id").isNumber())
                .andExpect(jsonPath("$.data.generation_job_id").doesNotExist())
                .andReturn();
        long inputRequestId = objectMapper.readTree(result.getResponse().getContentAsString())
                .path("data").path("input_request_id").asLong();

        // 来源 AgentRun 进入 awaiting_input / awaiting_clarification。
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM agent_runs WHERE id = ?", String.class, firstRun.asLong()))
                .isEqualTo("awaiting_input");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT stage FROM agent_runs WHERE id = ?", String.class, firstRun.asLong()))
                .isEqualTo("awaiting_clarification");
        // 创作澄清请求无报价字段，类型为 creation_clarification。
        assertThat(jdbcTemplate.queryForObject(
                "SELECT request_type FROM user_input_requests WHERE id = ?",
                String.class, inputRequestId)).isEqualTo("creation_clarification");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT quoted_amount_fen FROM user_input_requests WHERE id = ?",
                Long.class, inputRequestId)).isNull();
    }

    @Test
    void proposalMutuallyExclusiveWithActionsIsRejected() throws Exception {
        Project project = newProject();
        JsonNode firstRun = postMessage(project.getId(), "msg-1", "generate a whale poster", null)
                .path("agent_run_id");
        JsonNode work = claim(firstRun.asLong(), "worker-1");

        // 同时提交输入请求提议与动作 → PROPOSAL_ACTION_MUTEX。
        commit(firstRun.asLong(), "worker-1",
                        commitWithProposalAndAction(project.getId(), work, "commit-mutex"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.data.code").value("ACTION_NOT_ALLOWED"));
    }

    @Test
    void snapshotReturnsActiveClarificationRequest() throws Exception {
        Project project = newProject();
        JsonNode firstRun = postMessage(project.getId(), "msg-1", "generate a whale poster", null)
                .path("agent_run_id");
        JsonNode work = claim(firstRun.asLong(), "worker-1");
        commit(firstRun.asLong(), "worker-1",
                clarificationCommitBody(project.getId(), work, "commit-1", "Which style?"));

        MvcResult snapshot = mockMvc.perform(get("/api/projects/{id}/snapshot", project.getId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode run = objectMapper.readTree(snapshot.getResponse().getContentAsString())
                .path("data").path("agent_runs").get(0);
        // ADR-0016 §2：Snapshot 返回 AgentRun 当前活动请求（产品中性切片）。
        JsonNode active = run.path("active_input_request");
        assertThat(active.path("request_type").asText()).isEqualTo("creation_clarification");
        assertThat(active.path("question").asText()).isEqualTo("Which style?");
        assertThat(active.path("status").asText()).isEqualTo("pending");
        // 产品中性：不泄漏成本版本字段。
        assertThat(active.has("quoted_amount_fen")).isFalse();
        assertThat(active.has("price_catalog_version")).isFalse();
    }

    @Test
    void naturalLanguageAnswerResumesAgentRunWithAgentRunAggregateEvent() throws Exception {
        Project project = newProject();
        JsonNode firstRun = postMessage(project.getId(), "msg-1", "generate a whale poster", null)
                .path("agent_run_id");
        JsonNode work = claim(firstRun.asLong(), "worker-1");
        MvcResult proposed = commit(firstRun.asLong(), "worker-1",
                        clarificationCommitBody(project.getId(), work, "commit-1", "Which style?"))
                .andReturn();
        long inputRequestId = objectMapper.readTree(proposed.getResponse().getContentAsString())
                .path("data").path("input_request_id").asLong();

        // 任意非空自然语言回答即接纳（不限确认短语）。
        JsonNode resumed = postMessage(
                project.getId(), "answer-1", "ink wash style with whitespace", inputRequestId);

        // 创作澄清请求被确认，回答绑定到权威消息。
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM user_input_requests WHERE id = ?",
                String.class, inputRequestId)).isEqualTo("confirmed");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT answer_message_id FROM user_input_requests WHERE id = ?",
                Long.class, inputRequestId)).isNotNull();
        // resumed run 被绑定。
        assertThat(jdbcTemplate.queryForObject(
                "SELECT resumed_agent_run_id FROM user_input_requests WHERE id = ?",
                Long.class, inputRequestId)).isEqualTo(resumed.path("agent_run_id").asLong());

        // AgentRun 聚合事件（ADR-0016 §5）：requested 与 answered 使用 AgentRun 聚合身份。
        assertThat(jdbcTemplate.queryForList(
                "SELECT event_type FROM project_events WHERE event_type LIKE 'agent_run.user_input%' "
                        + "ORDER BY id", String.class))
                .containsExactly(
                        "agent_run.user_input_requested",
                        "agent_run.user_input_answered");
    }

    private Project newProject() {
        Project project = new Project().setOwnerId(10L).setName("creation-clarification");
        projectMapper.insert(project);
        return project;
    }

    private JsonNode postMessage(long projectId, String key, String content, Long inputRequestId)
            throws Exception {
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

    private String clarificationCommitBody(long projectId, JsonNode work, String commitId, String question) {
        return "{" +
                "\"commit_id\":\"" + commitId + "\"," +
                "\"project_id\":" + projectId + "," +
                "\"user_id\":10," +
                "\"expected_run_version\":" + work.path("run_version").asInt() + "," +
                "\"fencing_token\":" + work.path("fencing_token").asLong() + "," +
                "\"engine\":\"fake\"," +
                "\"engine_version\":\"1\"," +
                "\"adapter_schema_version\":1," +
                "\"visible_text\":\"" + question + "\"," +
                "\"checkpoint\":{\"opaque_payload\":{\"step\":\"clarification_proposed\"}}," +
                "\"actions\":[]," +
                "\"user_input_request\":{\"request_type\":\"creation_clarification\"," +
                "\"question\":\"" + question + "\"}}";
    }

    private String commitWithProposalAndAction(long projectId, JsonNode work, String commitId) {
        return "{" +
                "\"commit_id\":\"" + commitId + "\"," +
                "\"project_id\":" + projectId + "," +
                "\"user_id\":10," +
                "\"expected_run_version\":" + work.path("run_version").asInt() + "," +
                "\"fencing_token\":" + work.path("fencing_token").asLong() + "," +
                "\"engine\":\"fake\"," +
                "\"engine_version\":\"1\"," +
                "\"adapter_schema_version\":1," +
                "\"visible_text\":\"mutex test\"," +
                "\"checkpoint\":{\"opaque_payload\":{\"step\":\"mutex\"}}," +
                "\"actions\":[{\"action_id\":\"action-1\",\"action_type\":\"generate_image\"," +
                "\"arguments\":{\"prompt\":\"whale\",\"aspect_ratio\":\"1:1\"}}]," +
                "\"user_input_request\":{\"request_type\":\"creation_clarification\"," +
                "\"question\":\"style?\"}}";
    }

    private String messageBody(String clientId, String content, Long inputRequestId) {
        return "{\"client_message_id\":\"" + clientId + "\",\"content\":\"" + content + "\""
                + (inputRequestId == null ? "" : ",\"reply_to_input_request_id\":" + inputRequestId)
                + "}";
    }
}
