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

import java.util.Map;

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

    @Test
    void resumedRunInheritsSourceEngineAndWorkPackageCarriesSourceCheckpoint() throws Exception {
        Project project = newProject();
        JsonNode firstRun = postMessage(project.getId(), "msg-1", "generate a whale poster", null)
                .path("agent_run_id");
        JsonNode work = claim(firstRun.asLong(), "worker-1");

        // 模拟 source run 创建于旧引擎版本：消息接受只能取配置默认（fake/1/1），
        // 历史 run 的引擎身份用 SQL 直接固定。
        jdbcTemplate.update(
                "UPDATE agent_runs SET engine_version = ?, adapter_schema_version = ? WHERE id = ?",
                "0.9", 7, firstRun.asLong());

        MvcResult proposed = commit(firstRun.asLong(), "worker-1",
                        clarificationCommitBody(project.getId(), work, "commit-1", "Which style?", "0.9", 7))
                .andExpect(status().isOk())
                .andReturn();
        long inputRequestId = objectMapper.readTree(proposed.getResponse().getContentAsString())
                .path("data").path("input_request_id").asLong();

        JsonNode resumed = postMessage(
                project.getId(), "answer-1", "ink wash style with whitespace", inputRequestId);
        long resumedRunId = resumed.path("agent_run_id").asLong();

        // resumed run 继承 source run 的引擎身份，而非配置默认 fake/1/1。
        Map<String, Object> resumedRow = jdbcTemplate.queryForMap(
                "SELECT engine, engine_version, adapter_schema_version FROM agent_runs WHERE id = ?",
                resumedRunId);
        assertThat(resumedRow.get("engine")).isEqualTo("fake");
        assertThat(resumedRow.get("engine_version")).isEqualTo("0.9");
        assertThat(((Number) resumedRow.get("adapter_schema_version")).intValue()).isEqualTo(7);

        // claim resumed run：工作包携带 source 流程已接纳的 RuntimeCheckpoint，且三件套匹配。
        JsonNode resumedWork = claim(resumedRunId, "worker-2");
        assertThat(resumedWork.path("agent_run_id").asLong()).isEqualTo(resumedRunId);
        JsonNode checkpoint = resumedWork.path("checkpoint");
        assertThat(checkpoint == null || checkpoint.isNull()).isFalse();
        assertThat(checkpoint.path("engine").asText()).isEqualTo("fake");
        assertThat(checkpoint.path("engine_version").asText()).isEqualTo("0.9");
        assertThat(checkpoint.path("adapter_schema_version").asInt()).isEqualTo(7);
        assertThat(checkpoint.path("opaque_payload").path("step").asText())
                .isEqualTo("clarification_proposed");

        // 恢复后只提交一个 generate_image 动作：恰好一个 queued、source=agent_run、
        // 关联 resumed run 的 GenerationJob，请求一次性消费。
        commit(resumedRunId, "worker-2",
                        actionCommitBody(project.getId(), resumedWork, "commit-2",
                                "whale poster, ink wash style with whitespace", "0.9", 7))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.generation_job_id").isNumber());
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM generation_jobs WHERE project_id = ?",
                Long.class, project.getId())).isEqualTo(1L);
        Map<String, Object> job = jdbcTemplate.queryForMap(
                "SELECT status, source, agent_run_id FROM generation_jobs WHERE project_id = ?",
                project.getId());
        assertThat(job.get("status")).isEqualTo("queued");
        assertThat(job.get("source")).isEqualTo("agent_run");
        assertThat(((Number) job.get("agent_run_id")).longValue()).isEqualTo(resumedRunId);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM user_input_requests WHERE id = ?",
                String.class, inputRequestId)).isEqualTo("consumed");
    }

    @Test
    void resumedImageActionInjectsCapabilityDefaultModelId() throws Exception {
        Project project = newProject();
        JsonNode firstRun = postMessage(project.getId(), "msg-1", "generate a whale poster", null)
                .path("agent_run_id");
        JsonNode work = claim(firstRun.asLong(), "worker-1");
        MvcResult proposed = commit(firstRun.asLong(), "worker-1",
                        clarificationCommitBody(project.getId(), work, "commit-1", "Which style?"))
                .andReturn();
        long inputRequestId = objectMapper.readTree(proposed.getResponse().getContentAsString())
                .path("data").path("input_request_id").asLong();

        JsonNode resumed = postMessage(
                project.getId(), "answer-1", "ink wash style with whitespace", inputRequestId);
        long resumedRunId = resumed.path("agent_run_id").asLong();
        JsonNode resumedWork = claim(resumedRunId, "worker-2");
        commit(resumedRunId, "worker-2",
                        actionCommitBody(project.getId(), resumedWork, "commit-2",
                                "whale poster, ink wash style with whitespace", "1", 1)
                                .replace("\"aspect_ratio\":\"1:1\"",
                                        "\"aspect_ratio\":\"1:1\",\"size\":\"2K\",\"web_search\":true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.generation_job_id").isNumber());

        // IK21O7：澄清恢复后的再次提交同样注入能力表默认模型、规范化 size 并透传
        // web_search，真图链路行为与直接提交一致。
        JsonNode input = objectMapper.readTree(jdbcTemplate.queryForObject(
                "SELECT input FROM generation_jobs WHERE agent_run_id = ?", String.class, resumedRunId));
        assertThat(input.path("model_id").asText()).isEqualTo("doubao-seedream-5.0-lite");
        assertThat(input.path("expected_output_count").asInt()).isEqualTo(1);
        assertThat(input.path("size").asText()).isEqualTo("2k");
        assertThat(input.path("web_search").asBoolean()).isTrue();
    }

    @Test
    void duplicateAnswerDoesNotCreateSecondResumedRunAndIdempotentReplayIsStable() throws Exception {
        Project project = newProject();
        JsonNode firstRun = postMessage(project.getId(), "msg-1", "generate a whale poster", null)
                .path("agent_run_id");
        JsonNode work = claim(firstRun.asLong(), "worker-1");
        MvcResult proposed = commit(firstRun.asLong(), "worker-1",
                        clarificationCommitBody(project.getId(), work, "commit-1", "Which style?"))
                .andReturn();
        long inputRequestId = objectMapper.readTree(proposed.getResponse().getContentAsString())
                .path("data").path("input_request_id").asLong();

        JsonNode resumed = postMessage(
                project.getId(), "answer-1", "ink wash style with whitespace", inputRequestId);
        long resumedRunId = resumed.path("agent_run_id").asLong();

        // 迟到/重复回答（新幂等键）：拒绝，不产生第二个 resumed run。
        mockMvc.perform(post("/api/projects/{id}/conversation/messages", project.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "answer-2")
                        .contentType("application/json")
                        .content(messageBody("client-answer-2", "watercolor instead", inputRequestId)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.data.code").value("ACTION_NOT_ALLOWED"));
        // 同一命令的幂等重放：结果稳定，仍返回原 resumed run。
        JsonNode replayed = postMessage(
                project.getId(), "answer-1", "ink wash style with whitespace", inputRequestId);
        assertThat(replayed.path("agent_run_id").asLong()).isEqualTo(resumedRunId);

        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM agent_runs WHERE project_id = ?",
                Long.class, project.getId())).isEqualTo(2L);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM user_input_requests WHERE id = ?",
                String.class, inputRequestId)).isEqualTo("confirmed");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM generation_jobs WHERE project_id = ?",
                Long.class, project.getId())).isEqualTo(0L);
    }

    @Test
    void expiredRequestRejectsLateAnswerWithoutResuming() throws Exception {
        Project project = newProject();
        JsonNode firstRun = postMessage(project.getId(), "msg-1", "generate a whale poster", null)
                .path("agent_run_id");
        JsonNode work = claim(firstRun.asLong(), "worker-1");
        MvcResult proposed = commit(firstRun.asLong(), "worker-1",
                        clarificationCommitBody(project.getId(), work, "commit-1", "Which style?"))
                .andReturn();
        long inputRequestId = objectMapper.readTree(proposed.getResponse().getContentAsString())
                .path("data").path("input_request_id").asLong();

        // 请求已过期：迟到回答被拒绝，source run 保持等待输入，不创建 resumed run。
        jdbcTemplate.update("UPDATE user_input_requests SET expires_at = ? WHERE id = ?",
                java.sql.Timestamp.from(java.time.Instant.now().minusSeconds(60)), inputRequestId);
        mockMvc.perform(post("/api/projects/{id}/conversation/messages", project.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "answer-late")
                        .contentType("application/json")
                        .content(messageBody("client-answer-late", "too late", inputRequestId)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.data.code").value("ACTION_NOT_ALLOWED"));

        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM user_input_requests WHERE id = ?",
                String.class, inputRequestId)).isEqualTo("expired");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM agent_runs WHERE project_id = ?",
                Long.class, project.getId())).isEqualTo(1L);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM agent_runs WHERE id = ?",
                String.class, firstRun.asLong())).isEqualTo("awaiting_input");
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
        return clarificationCommitBody(projectId, work, commitId, question, "1", 1);
    }

    private String clarificationCommitBody(long projectId, JsonNode work, String commitId, String question,
                                           String engineVersion, int adapterSchemaVersion) {
        return "{" +
                "\"commit_id\":\"" + commitId + "\"," +
                "\"project_id\":" + projectId + "," +
                "\"user_id\":10," +
                "\"expected_run_version\":" + work.path("run_version").asInt() + "," +
                "\"fencing_token\":" + work.path("fencing_token").asLong() + "," +
                "\"engine\":\"fake\"," +
                "\"engine_version\":\"" + engineVersion + "\"," +
                "\"adapter_schema_version\":" + adapterSchemaVersion + "," +
                "\"visible_text\":\"" + question + "\"," +
                "\"checkpoint\":{\"opaque_payload\":{\"step\":\"clarification_proposed\"}}," +
                "\"actions\":[]," +
                "\"user_input_request\":{\"request_type\":\"creation_clarification\"," +
                "\"question\":\"" + question + "\"}}";
    }

    private String actionCommitBody(long projectId, JsonNode work, String commitId, String prompt,
                                    String engineVersion, int adapterSchemaVersion) {
        return "{" +
                "\"commit_id\":\"" + commitId + "\"," +
                "\"project_id\":" + projectId + "," +
                "\"user_id\":10," +
                "\"expected_run_version\":" + work.path("run_version").asInt() + "," +
                "\"fencing_token\":" + work.path("fencing_token").asLong() + "," +
                "\"engine\":\"fake\"," +
                "\"engine_version\":\"" + engineVersion + "\"," +
                "\"adapter_schema_version\":" + adapterSchemaVersion + "," +
                "\"visible_text\":\"已按澄清回答准备好图片动作。\"," +
                "\"checkpoint\":{\"opaque_payload\":{\"step\":\"image_proposed\"," +
                "\"prompt\":\"" + prompt + "\"}}," +
                "\"actions\":[{\"action_id\":\"action-resume-1\",\"action_type\":\"generate_image\"," +
                "\"arguments\":{\"prompt\":\"" + prompt + "\",\"aspect_ratio\":\"1:1\"}}]}";
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
