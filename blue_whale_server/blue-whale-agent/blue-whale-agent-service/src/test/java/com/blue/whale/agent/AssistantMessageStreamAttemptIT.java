package com.blue.whale.agent;

import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.service.ProjectEventService;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * IK3GIM 回复流尝试契约 IT：幂等 abort、两次尝试额度与单活动约束、
 * 租约接管 / supersede 兜底、released/unreleased 边界与 Snapshot/重放一致性。
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
        "blue-whale.generation.mode=fake",
        "blue-whale.generation.fake-allowed=true"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AssistantMessageStreamAttemptIT extends AssistantMessageStreamITBase {

    @Autowired
    private ProjectEventService projectEventService;

    @Test
    void abortReplayIsIdempotentAndBindingIsValidated() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("assistant-abort-idem");
        projectMapper.insert(project);
        long runId = postMessage(project.getId()).path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String binding = binding(project.getId(), work);
        String streamId = "assistant-abort-stream-" + runId;
        String abort = "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"abort-idem-key\",\"reason_code\":\"CANCELLED\","
                + binding + "}";

        postStream(runId, "start", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"start-abort-idem\"," + binding + "}")
                .andExpect(status().isOk());
        MvcResult first = postStream(runId, "abort", abort)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("aborted"))
                .andReturn();
        MvcResult replay = postStream(runId, "abort", abort)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("aborted"))
                .andReturn();
        assertThat(objectMapper.readTree(replay.getResponse().getContentAsString()).path("data"))
                .isEqualTo(objectMapper.readTree(first.getResponse().getContentAsString()).path("data"));

        // 同流异键 / 同键异 reason → 幂等冲突。
        postStream(runId, "abort", abort.replace("abort-idem-key", "abort-other-key"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100302));
        postStream(runId, "abort", abort.replace("CANCELLED", "DISCONNECT"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100302));
        // RunBinding 校验与 start/chunk/complete 一致：错误 fencing → 409；缺 worker → 401。
        postStream(runId, "abort", abort.replace(
                "\"fencing_token\":" + work.path("fencing_token").asLong(),
                "\"fencing_token\":" + (work.path("fencing_token").asLong() + 1)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100303));
        mockMvc.perform(post("/internal/agent-runs/{id}/assistant-messages/abort", runId)
                        .contentType("application/json")
                        .content(abort))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void secondAttemptUsesNewStreamAndMessageAndThirdStartIsExhausted() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("assistant-attempts");
        projectMapper.insert(project);
        long runId = postMessage(project.getId()).path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String binding = binding(project.getId(), work);
        String streamOne = "assistant-attempt-1-" + runId;
        String streamTwo = "assistant-attempt-2-" + runId;

        postStream(runId, "start", "{\"stream_id\":\"" + streamOne
                + "\",\"idempotency_key\":\"start-attempt-1\"," + binding + "}")
                .andExpect(status().isOk());
        // 存在活动尝试时，新 stream_id 的 start 收 409 AGENT_RUN_CONFLICT。
        postStream(runId, "start", "{\"stream_id\":\"" + streamTwo
                + "\",\"idempotency_key\":\"start-attempt-2\"," + binding + "}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100303));
        postStream(runId, "abort", "{\"stream_id\":\"" + streamOne
                + "\",\"idempotency_key\":\"abort-attempt-1\",\"reason_code\":\"CANCELLED\","
                + binding + "}")
                .andExpect(status().isOk());

        MvcResult second = postStream(runId, "start", "{\"stream_id\":\"" + streamTwo
                + "\",\"idempotency_key\":\"start-attempt-2\"," + binding + "}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stream_id").value(streamTwo))
                .andReturn();
        long secondMessageId = objectMapper.readTree(second.getResponse().getContentAsString())
                .path("data").path("message_id").asLong();
        Long firstMessageId = jdbcTemplate.queryForObject(
                "SELECT message_id FROM assistant_message_streams WHERE stream_id = ?",
                Long.class, streamOne);
        assertThat(secondMessageId).isNotEqualTo(firstMessageId);
        // 每次尝试建立自己的 ConversationMessage，sequence_no 递增。
        assertThat(jdbcTemplate.queryForObject(
                "SELECT sequence_no FROM conversation_messages WHERE id = ?",
                Integer.class, secondMessageId)).isEqualTo(3);

        // 后继尝试的在线事件、重放与 Snapshot 观察一致：aborted 在前、新尝试在后。
        postStream(runId, "chunks", "{\"stream_id\":\"" + streamTwo
                + "\",\"idempotency_key\":\"chunk-attempt-2\",\"sequence_no\":1,"
                + "\"content\":\"重跑的新前缀\","
                + "\"review_evidence\":{\"source\":\"local-fake\"}," + binding + "}")
                .andExpect(status().isOk());
        assertThat(projectEventService.eventsAfter(project.getId(), 0, 100).stream()
                .filter(event -> "conversation.message_started".equals(event.getEventType()))
                .map(event -> String.valueOf(event.getPayload().get("stream_id"))))
                .containsExactly(streamOne, streamTwo);
        mockMvc.perform(get("/api/projects/{id}/snapshot", project.getId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.conversation_messages[1].status").value("aborted"))
                .andExpect(jsonPath("$.data.conversation_messages[2].content").value("重跑的新前缀"))
                .andExpect(jsonPath("$.data.conversation_messages[2].status").value("streaming"));

        postStream(runId, "abort", "{\"stream_id\":\"" + streamTwo
                + "\",\"idempotency_key\":\"abort-attempt-2\",\"reason_code\":\"DISCONNECT\","
                + binding + "}")
                .andExpect(status().isOk());
        // 第三次 start：稳定错误码 100305，Worker 不再调用模型。
        postStream(runId, "start", "{\"stream_id\":\"assistant-attempt-3-" + runId
                + "\",\"idempotency_key\":\"start-attempt-3\"," + binding + "}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100305));
    }

    @Test
    void abortKeepsReleasedPrefixDiscardsUnreleasedTailAndSealsMessage() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("assistant-abort-boundary");
        projectMapper.insert(project);
        long runId = postMessage(project.getId()).path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String binding = binding(project.getId(), work);
        String streamId = "assistant-abort-boundary-" + runId;

        postStream(runId, "start", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"start-boundary\"," + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "chunks", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-boundary-1\",\"sequence_no\":1,"
                + "\"content\":\"已放行前缀，\","
                + "\"review_evidence\":{\"source\":\"local-fake\"}," + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "chunks", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-boundary-2\",\"sequence_no\":2,"
                + "\"content\":\"未放行私有尾部\"," + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "abort", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"abort-boundary\",\"reason_code\":\"PROTOCOL_MIXED_STREAM\","
                + binding + "}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.released_sequence_no").value(1));

        // 已放行前缀保留、未放行私有尾部擦除、流与消息均 aborted 终态。
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM assistant_message_streams WHERE stream_id = ?",
                String.class, streamId)).isEqualTo("aborted");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT abort_reason_code FROM assistant_message_streams WHERE stream_id = ?",
                String.class, streamId)).isEqualTo("PROTOCOL_MIXED_STREAM");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM assistant_message_chunks WHERE content LIKE '%未放行私有尾部%'",
                Long.class)).isZero();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT content FROM conversation_messages WHERE stream_id = ?",
                String.class, streamId)).isEqualTo("已放行前缀，");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM conversation_messages WHERE stream_id = ?",
                String.class, streamId)).isEqualTo("aborted");

        // 封口事件：在线事件流与重放（eventsAfter）同源，payload 携带 aborted 终态。
        assertThat(eventTypes(project.getId())).containsSubsequence(
                "conversation.message_started",
                "conversation.message_chunk_appended",
                "conversation.message_completed");
        assertThat(projectEventService.eventsAfter(project.getId(), 0, 100).stream()
                .filter(event -> "conversation.message_completed".equals(event.getEventType()))
                .map(event -> String.valueOf(event.getPayload().get("status"))))
                .containsExactly("aborted");
        mockMvc.perform(get("/api/projects/{id}/snapshot", project.getId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.conversation_messages[1].content").value("已放行前缀，"))
                .andExpect(jsonPath("$.data.conversation_messages[1].status").value("aborted"));
    }

    @Test
    void abortedAttemptRejectsAppendAndComplete() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("assistant-abort-terminal");
        projectMapper.insert(project);
        long runId = postMessage(project.getId()).path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String binding = binding(project.getId(), work);
        String streamId = "assistant-abort-terminal-" + runId;

        postStream(runId, "start", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"start-terminal\"," + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "chunks", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-terminal\",\"sequence_no\":1,"
                + "\"content\":\"已缓冲\"," + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "abort", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"abort-terminal\",\"reason_code\":\"CANCELLED\","
                + binding + "}")
                .andExpect(status().isOk());

        // aborted 不可续写、不可 complete；completed 流也不可 abort。
        postStream(runId, "chunks", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-after-abort\",\"sequence_no\":2,"
                + "\"content\":\"续写禁止\"," + binding + "}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100303));
        postStream(runId, "complete", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"complete-after-abort\",\"final_sequence_no\":1,"
                + "\"content_digest\":\"" + digest("已缓冲") + "\"," + binding + "}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100303));
    }

    @Test
    void leaseTakeoverAbortsLeftoverAttemptButExpiryAloneDoesNot() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("assistant-takeover");
        projectMapper.insert(project);
        long runId = postMessage(project.getId()).path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String binding = binding(project.getId(), work);
        String streamId = "assistant-takeover-" + runId;

        postStream(runId, "start", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"start-takeover\"," + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "chunks", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-takeover\",\"sequence_no\":1,"
                + "\"content\":\"断连前的缓冲\"," + binding + "}")
                .andExpect(status().isOk());

        // 仅租约自然过期：尝试状态不变。
        jdbcTemplate.update(
                "UPDATE agent_runs SET lease_expires_at = '2000-01-01 00:00:00' WHERE id = ?", runId);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM assistant_message_streams WHERE stream_id = ?",
                String.class, streamId)).isEqualTo("streaming");

        // 下一次租约接管：同事务原子 abort 遗留活动尝试，再交付新租约。
        JsonNode reclaimed = claim(runId);
        assertThat(reclaimed.path("fencing_token").asLong())
                .isEqualTo(work.path("fencing_token").asLong() + 1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM assistant_message_streams WHERE stream_id = ?",
                String.class, streamId)).isEqualTo("aborted");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT abort_reason_code FROM assistant_message_streams WHERE stream_id = ?",
                String.class, streamId)).isEqualTo("LEASE_TAKEOVER");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM conversation_messages WHERE stream_id = ?",
                String.class, streamId)).isEqualTo("aborted");

        // 旧 Worker 持旧 fencing 的后续写入继续被 409 拒绝。
        postStream(runId, "chunks", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-stale-worker\",\"sequence_no\":2,"
                + "\"content\":\"旧 Worker 迟到写入\"," + binding + "}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100303));
        // 新租约下可用新 stream_id 开第二次尝试。
        String newBinding = binding(project.getId(), reclaimed);
        postStream(runId, "start", "{\"stream_id\":\"assistant-takeover-2-" + runId
                + "\",\"idempotency_key\":\"start-takeover-2\"," + newBinding + "}")
                .andExpect(status().isOk());
    }

    @Test
    void supersedeAbortsLeftoverAttemptWithoutStreamingGhost() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("assistant-supersede");
        projectMapper.insert(project);
        long runId = postMessage(project.getId()).path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String binding = binding(project.getId(), work);
        String streamId = "assistant-supersede-" + runId;

        postStream(runId, "start", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"start-supersede\"," + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "chunks", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-supersede\",\"sequence_no\":1,"
                + "\"content\":\"取代前的缓冲\"," + binding + "}")
                .andExpect(status().isOk());

        // 同会话新用户消息取代在途 Run：遗留尝试被兜底 abort，不留 streaming 残影。
        mockMvc.perform(post("/api/projects/{id}/conversation/messages", project.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "stream-user-message-2")
                        .contentType("application/json")
                        .content("{\"client_message_id\":\"stream-user-2\","
                                + "\"content\":\"换个目标\"}"))
                .andExpect(status().isAccepted());

        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM assistant_message_streams WHERE stream_id = ?",
                String.class, streamId)).isEqualTo("aborted");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT abort_reason_code FROM assistant_message_streams WHERE stream_id = ?",
                String.class, streamId)).isEqualTo("SUPERSEDED");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM conversation_messages WHERE status = 'streaming'",
                Long.class)).isZero();
        mockMvc.perform(get("/api/projects/{id}/snapshot", project.getId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.conversation_messages[1].status").value("aborted"));
    }
}
