package com.blue.whale.agent;

import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.entity.Project;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * AgentRun 三种规范化收场契约测试（IK3BG2 / ADR-0043）。
 *
 * <p>覆盖：零动作完成（completed，含恢复后纯文本）、新消息取代在途 Run（superseded，旧 Worker
 * 后续 commit 收 409）、Worker 错误 commit 接纳为终态（failed，error_code/error_message 落列、
 * 列长截断兜底、终态不再被 claim/重放）、顺序多轮澄清合法化与「同时最多一个活动请求」铁闸。
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
class AgentRunTerminalOutcomesIT {

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

    @AfterEach
    void leaveNoClaimableRunBehind() {
        // 兜底：本类故意遗留的非终态 Run（如铁闸拒绝后的 running）租约过期后会被后续测试类的
        // claim 抢走，统一置为终态避免污染套件（已有 IT 类只清理表、遗留均为终态）。
        jdbcTemplate.update("UPDATE agent_runs SET status = 'superseded'"
                + " WHERE status IN ('queued','running','awaiting_job','awaiting_input')");
    }

    @Test
    void resumedRunPlainTextCompletionConsumesClarificationAndCompletes() throws Exception {
        // 恢复后纯文本的零动作 commit 合法完成 Run；恢复绑定的创作澄清在 commit 接纳时消费。
        Project project = newProject();
        long firstRunId = postMessage(project.getId(), "msg-1", "generate a whale poster", null)
                .path("agent_run_id").asLong();
        JsonNode work = claim("worker-1");
        MvcResult proposed = commit(firstRunId, "worker-1",
                        clarificationCommitBody(project.getId(), work, "commit-1", "Which style?"))
                .andExpect(status().isOk())
                .andReturn();
        long inputRequestId = objectMapper.readTree(proposed.getResponse().getContentAsString())
                .path("data").path("input_request_id").asLong();

        long resumedRunId = postMessage(project.getId(), "answer-1", "ink wash style", inputRequestId)
                .path("agent_run_id").asLong();
        JsonNode resumedWork = claim("worker-2");

        commit(resumedRunId, "worker-2",
                        plainTextCommitBody(project.getId(), resumedWork, "commit-2", "好的，按水墨风格继续。"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.checkpoint_id").isNumber())
                .andExpect(jsonPath("$.data.generation_job_id").doesNotExist())
                .andExpect(jsonPath("$.data.input_request_id").doesNotExist());

        assertThat(runStatus(resumedRunId)).isEqualTo("completed");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM user_input_requests WHERE id = ?",
                String.class, inputRequestId)).isEqualTo("consumed");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM generation_jobs WHERE project_id = ?",
                Long.class, project.getId())).isEqualTo(0L);
    }

    @Test
    void sequentialMultipleClarificationsAreAccepted() throws Exception {
        // 顺序多轮澄清合法：恢复后可再澄清，唯一约束是「同时最多一个活动请求」。
        Project project = newProject();
        long runId = postMessage(project.getId(), "msg-1", "generate a whale poster", null)
                .path("agent_run_id").asLong();

        long firstRequestId = proposeClarification(project.getId(), runId, "worker-1",
                "commit-1", "Which style?");
        long resumedRunId2 = postMessage(project.getId(), "answer-1", "ink wash", firstRequestId)
                .path("agent_run_id").asLong();
        // 回答恢复时来源 Run 已被新 Run 取代（superseded 终态）。
        assertThat(runStatus(runId)).isEqualTo("superseded");

        long secondRequestId = proposeClarification(project.getId(), resumedRunId2, "worker-2",
                "commit-2", "Landscape or portrait?");
        // 第一轮请求在第二轮 commit 接纳时已消费。
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM user_input_requests WHERE id = ?",
                String.class, firstRequestId)).isEqualTo("consumed");

        long resumedRunId3 = postMessage(project.getId(), "answer-2", "landscape", secondRequestId)
                .path("agent_run_id").asLong();
        assertThat(runStatus(resumedRunId2)).isEqualTo("superseded");

        long thirdRequestId = proposeClarification(project.getId(), resumedRunId3, "worker-3",
                "commit-3", "Need a slogan?");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM user_input_requests WHERE id = ?",
                String.class, secondRequestId)).isEqualTo("consumed");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM user_input_requests WHERE id = ?",
                String.class, thirdRequestId)).isEqualTo("pending");
        assertThat(runStatus(resumedRunId3)).isEqualTo("awaiting_input");
    }

    @Test
    void concurrentProposalWithActiveRequestIsRejected() throws Exception {
        // 「同时最多一个活动请求」铁闸仍在：仍有活动请求（pending/confirmed 且未过期未消费）时
        // 的并发提议被拒绝。该状态经公开流程不可达（提议接纳即 awaiting_input），直接白盒构造。
        Project project = newProject();
        long runId = postMessage(project.getId(), "msg-1", "generate a whale poster", null)
                .path("agent_run_id").asLong();
        JsonNode work = claim("worker-1");
        long conversationId = jdbcTemplate.queryForObject(
                "SELECT conversation_id FROM agent_runs WHERE id = ?", Long.class, runId);
        jdbcTemplate.update(
                "INSERT INTO user_input_requests (project_id, user_id, request_type, conversation_id,"
                        + " source_agent_run_id, question, action_identity, action_type,"
                        + " arguments_digest, status, expires_at)"
                        + " VALUES (?, 10, 'creation_clarification', ?, ?, 'Already open?',"
                        + " 'clarification:" + runId + "', 'creation_clarification', 'digest',"
                        + " 'pending', ?)",
                project.getId(), conversationId, runId,
                Timestamp.from(Instant.now().plusSeconds(600)));

        commit(runId, "worker-1",
                        clarificationCommitBody(project.getId(), work, "commit-1", "Another question?"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.data.code").value("ACTION_NOT_ALLOWED"));

        assertThat(runStatus(runId)).isEqualTo("running");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM user_input_requests WHERE project_id = ?",
                Long.class, project.getId())).isEqualTo(1L);
    }

    @Test
    void errorCommitTransitionsRunToFailedWithPersistedErrorColumns() throws Exception {
        // error 通道从硬拒改为终态接纳：Run 进 failed，error_code/error_message 落列、释放租约，
        // 终态不再被 claim/重放；同 commit_id 幂等重放结果稳定。
        Project project = newProject();
        long runId = postMessage(project.getId(), "msg-1", "generate a whale poster", null)
                .path("agent_run_id").asLong();
        JsonNode work = claim("worker-1");

        String body = errorCommitBody(project.getId(), work, "commit-fail-1",
                "ORCHESTRATOR_CONTRACT_MISMATCH", "编排暂时无法继续。");
        MvcResult first = commit(runId, "worker-1", body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.checkpoint_id").isNumber())
                .andReturn();

        Map<String, Object> run = jdbcTemplate.queryForMap(
                "SELECT status, stage, error_code, error_message, lease_owner FROM agent_runs WHERE id = ?",
                runId);
        assertThat(run.get("status")).isEqualTo("failed");
        assertThat(run.get("stage")).isEqualTo("failed");
        assertThat(run.get("error_code")).isEqualTo("ORCHESTRATOR_CONTRACT_MISMATCH");
        assertThat(run.get("error_message")).isEqualTo("编排暂时无法继续。");
        assertThat(run.get("lease_owner")).isNull();

        // 幂等重放：结果稳定，不重复落事实。
        MvcResult replay = commit(runId, "worker-1", body)
                .andExpect(status().isOk())
                .andReturn();
        assertThat(replay.getResponse().getContentAsString())
                .isEqualTo(first.getResponse().getContentAsString());
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM run_commits WHERE agent_run_id = ?",
                Long.class, runId)).isEqualTo(1L);

        // failed 终态不再被 claim/重放。
        mockMvc.perform(post("/internal/agent-runs/claim")
                        .header("X-Worker-Id", "worker-2")
                        .header("X-Orchestrator-Engine", "fake"))
                .andExpect(status().isNotFound());
    }

    @Test
    void errorMessageIsTruncatedToColumnLength() throws Exception {
        // 列长截断兜底：error_code ≤ 96、error_message ≤ 1024。
        Project project = newProject();
        long runId = postMessage(project.getId(), "msg-1", "generate a whale poster", null)
                .path("agent_run_id").asLong();
        JsonNode work = claim("worker-1");

        commit(runId, "worker-1",
                        errorCommitBody(project.getId(), work, "commit-fail-1",
                                "E".repeat(200), "超".repeat(2000)))
                .andExpect(status().isOk());

        Map<String, Object> run = jdbcTemplate.queryForMap(
                "SELECT error_code, error_message FROM agent_runs WHERE id = ?", runId);
        assertThat(((String) run.get("error_code")).length()).isEqualTo(96);
        assertThat(((String) run.get("error_message")).length()).isEqualTo(1024);
    }

    @Test
    void newMessageSupersedesInFlightRunAndOldWorkerCommitGets409() throws Exception {
        // 新目标消息创建新 Run 时，同 Conversation 在途 Run 原子置 superseded（fencing token
        // 递增、释放租约）；在途旧 Worker 后续 commit 收到 409（AGENT_RUN_CONFLICT）。
        Project project = newProject();
        long runId = postMessage(project.getId(), "msg-1", "generate a whale poster", null)
                .path("agent_run_id").asLong();
        JsonNode work = claim("worker-1");

        long newRunId = postMessage(project.getId(), "msg-2", "actually make a video", null)
                .path("agent_run_id").asLong();
        assertThat(newRunId).isNotEqualTo(runId);

        Map<String, Object> stale = jdbcTemplate.queryForMap(
                "SELECT status, stage, fencing_token, lease_owner, lease_expires_at FROM agent_runs"
                        + " WHERE id = ?", runId);
        assertThat(stale.get("status")).isEqualTo("superseded");
        assertThat(stale.get("stage")).isEqualTo("superseded");
        assertThat(((Number) stale.get("fencing_token")).longValue())
                .isEqualTo(work.path("fencing_token").asLong() + 1);
        assertThat(stale.get("lease_owner")).isNull();
        assertThat(stale.get("lease_expires_at")).isNull();

        // 旧 Worker 后续 commit（持旧 version / fencing / 租约）→ 409 AGENT_RUN_CONFLICT。
        commit(runId, "worker-1",
                        plainTextCommitBody(project.getId(), work, "commit-stale", "迟到的收尾。"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100303));
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM run_commits WHERE agent_run_id = ?",
                Long.class, runId)).isEqualTo(0L);

        // 新 Run 正常可认领。
        JsonNode newWork = claim("worker-2");
        assertThat(newWork.path("agent_run_id").asLong()).isEqualTo(newRunId);
    }

    private long proposeClarification(long projectId, long runId, String workerId,
                                      String commitId, String question) throws Exception {
        JsonNode work = claim(workerId);
        assertThat(work.path("agent_run_id").asLong()).isEqualTo(runId);
        MvcResult proposed = commit(runId, workerId,
                        clarificationCommitBody(projectId, work, commitId, question))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.input_request_id").isNumber())
                .andReturn();
        return objectMapper.readTree(proposed.getResponse().getContentAsString())
                .path("data").path("input_request_id").asLong();
    }

    private String runStatus(long runId) {
        return jdbcTemplate.queryForObject(
                "SELECT status FROM agent_runs WHERE id = ?", String.class, runId);
    }

    private Project newProject() {
        Project project = new Project().setOwnerId(10L).setName("terminal-outcomes");
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

    private JsonNode claim(String workerId) throws Exception {
        MvcResult result = mockMvc.perform(post("/internal/agent-runs/claim")
                        .header("X-Worker-Id", workerId)
                        .header("X-Orchestrator-Engine", "fake"))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private ResultActions commit(long runId, String workerId, String body) throws Exception {
        return mockMvc.perform(post("/internal/agent-runs/{id}/commits", runId)
                .header("X-Worker-Id", workerId)
                .contentType("application/json")
                .content(body));
    }

    private String clarificationCommitBody(long projectId, JsonNode work, String commitId, String question) {
        return "{"
                + "\"commit_id\":\"" + commitId + "\","
                + "\"project_id\":" + projectId + ","
                + "\"user_id\":10,"
                + "\"expected_run_version\":" + work.path("run_version").asInt() + ","
                + "\"fencing_token\":" + work.path("fencing_token").asLong() + ","
                + "\"engine\":\"fake\","
                + "\"engine_version\":\"1\","
                + "\"adapter_schema_version\":1,"
                + "\"visible_text\":\"" + question + "\","
                + "\"checkpoint\":{\"opaque_payload\":{\"step\":\"clarification_proposed\"}},"
                + "\"actions\":[],"
                + "\"user_input_request\":{\"request_type\":\"creation_clarification\","
                + "\"question\":\"" + question + "\"}}";
    }

    private String plainTextCommitBody(long projectId, JsonNode work, String commitId, String text) {
        return "{"
                + "\"commit_id\":\"" + commitId + "\","
                + "\"project_id\":" + projectId + ","
                + "\"user_id\":10,"
                + "\"expected_run_version\":" + work.path("run_version").asInt() + ","
                + "\"fencing_token\":" + work.path("fencing_token").asLong() + ","
                + "\"engine\":\"fake\","
                + "\"engine_version\":\"1\","
                + "\"adapter_schema_version\":1,"
                + "\"visible_text\":\"" + text + "\","
                + "\"checkpoint\":{\"opaque_payload\":{\"step\":\"plain_text\"}},"
                + "\"actions\":[]}";
    }

    private String errorCommitBody(long projectId, JsonNode work, String commitId,
                                   String code, String message) {
        return "{"
                + "\"commit_id\":\"" + commitId + "\","
                + "\"project_id\":" + projectId + ","
                + "\"user_id\":10,"
                + "\"expected_run_version\":" + work.path("run_version").asInt() + ","
                + "\"fencing_token\":" + work.path("fencing_token").asLong() + ","
                + "\"engine\":\"fake\","
                + "\"engine_version\":\"1\","
                + "\"adapter_schema_version\":1,"
                + "\"visible_text\":\"编排暂时无法继续。\","
                + "\"checkpoint\":{\"opaque_payload\":{\"step\":\"failed\"}},"
                + "\"actions\":[],"
                + "\"error\":{\"code\":\"" + code + "\",\"message\":\"" + message + "\"}}";
    }

    private String messageBody(String clientId, String content, Long inputRequestId) {
        return "{\"client_message_id\":\"" + clientId + "\",\"content\":\"" + content + "\""
                + (inputRequestId == null ? "" : ",\"reply_to_input_request_id\":" + inputRequestId)
                + "}";
    }
}
