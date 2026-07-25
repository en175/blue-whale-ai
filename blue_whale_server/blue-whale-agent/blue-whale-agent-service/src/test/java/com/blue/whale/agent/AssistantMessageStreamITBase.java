package com.blue.whale.agent;

import com.blue.whale.agent.mapper.ProjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Assistant 消息流 IT 的共享基座：数据清理、run 领取、绑定字段与流操作请求。 */
abstract class AssistantMessageStreamITBase {

    @Autowired
    protected MockMvc mockMvc;
    @Autowired
    protected ProjectMapper projectMapper;
    @Autowired
    protected JdbcTemplate jdbcTemplate;
    @Autowired
    protected ObjectMapper objectMapper;

    @BeforeEach
    void cleanStreamFacts() {
        jdbcTemplate.batchUpdate(
                "DELETE FROM content_reviews",
                "DELETE FROM audit_records",
                "DELETE FROM run_commits",
                "DELETE FROM runtime_checkpoints",
                "DELETE FROM command_idempotency",
                "DELETE FROM assistant_message_chunks",
                "DELETE FROM assistant_message_streams",
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

    protected JsonNode postMessage(Long projectId) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/projects/{id}/conversation/messages", projectId)
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "stream-user-message")
                        .contentType("application/json")
                        .content("{\"client_message_id\":\"stream-user-1\","
                                + "\"content\":\"请和我打招呼\"}"))
                .andExpect(status().isAccepted())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    protected JsonNode claim(long runId) throws Exception {
        MvcResult result = mockMvc.perform(post("/internal/agent-runs/claim")
                        .header("X-Worker-Id", "stream-worker")
                        .header("X-Orchestrator-Engine", "fake"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.agent_run_id").value(runId))
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    protected String binding(Long projectId, JsonNode work) {
        return "\"project_id\":" + projectId + ","
                + "\"user_id\":10,"
                + "\"expected_run_version\":" + work.path("run_version").asInt() + ","
                + "\"fencing_token\":" + work.path("fencing_token").asLong() + ","
                + "\"engine\":\"fake\","
                + "\"engine_version\":\"1\","
                + "\"adapter_schema_version\":1";
    }

    protected ResultActions postStream(long runId, String operation, String body) throws Exception {
        return mockMvc.perform(post("/internal/agent-runs/{id}/assistant-messages/{operation}",
                        runId, operation)
                .header("X-Worker-Id", "stream-worker")
                .contentType("application/json")
                .content(body));
    }

    protected List<String> eventTypes(Long projectId) {
        return jdbcTemplate.queryForList(
                "SELECT event_type FROM project_events WHERE project_id = ? ORDER BY event_cursor",
                String.class,
                projectId);
    }

    protected String digest(String content) throws Exception {
        return HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256")
                        .digest(content.getBytes(StandardCharsets.UTF_8)));
    }
}
