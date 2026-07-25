package com.blue.whale.agent;

import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.service.ProjectEventService;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
class AssistantMessageStreamingIT extends AssistantMessageStreamITBase {

    @Autowired
    private ProjectEventService projectEventService;


    @Test
    void reviewedChunksReachProjectEventsBeforeMessageCompletionAndMatchSnapshot() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("assistant-streaming");
        projectMapper.insert(project);
        long runId = postMessage(project.getId()).path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String binding = binding(project.getId(), work);
        String streamId = "assistant-stream-" + runId;
        String startKey = "assistant-" + "a".repeat(54);
        String chunkOneKey = "assistant-" + "b".repeat(54);
        String chunkTwoKey = "assistant-" + "c".repeat(54);
        String completeKey = "assistant-" + "d".repeat(54);

        postStream(runId, "start", "{"
                + "\"stream_id\":\"" + streamId + "\","
                + "\"idempotency_key\":\"" + startKey + "\"," + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "chunks", "{"
                + "\"stream_id\":\"" + streamId + "\","
                + "\"idempotency_key\":\"" + chunkOneKey + "\","
                + "\"sequence_no\":1,\"content\":\"你好，\","
                + "\"review_evidence\":{\"source\":\"local-fake\"},"
                + binding + "}")
                .andExpect(status().isOk());

        assertThat(eventTypes(project.getId())).containsSubsequence(
                "conversation.message_started",
                "conversation.message_chunk_appended");
        assertThat(eventTypes(project.getId())).doesNotContain("conversation.message_completed");
        mockMvc.perform(get("/api/projects/{id}/snapshot", project.getId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.conversation_messages[1].content").value("你好，"))
                .andExpect(jsonPath("$.data.conversation_messages[1].status").value("streaming"));

        postStream(runId, "chunks", "{"
                + "\"stream_id\":\"" + streamId + "\","
                + "\"idempotency_key\":\"" + chunkTwoKey + "\","
                + "\"sequence_no\":2,\"content\":\"世界\","
                + "\"review_evidence\":{\"source\":\"local-fake\"},"
                + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "complete", "{"
                + "\"stream_id\":\"" + streamId + "\","
                + "\"idempotency_key\":\"" + completeKey + "\","
                + "\"final_sequence_no\":2,"
                + "\"content_digest\":\"" + digest("你好，世界") + "\","
                + binding + "}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.message_id").isNumber())
                .andExpect(jsonPath("$.data.last_sequence_no").value(2));

        assertThat(eventTypes(project.getId())).containsSubsequence(
                "conversation.message_started",
                "conversation.message_chunk_appended",
                "conversation.message_chunk_appended",
                "conversation.message_completed");
        assertThat(projectEventService.eventsAfter(project.getId(), 0, 100).stream()
                .filter(event -> "conversation.message_chunk_appended".equals(event.getEventType()))
                .map(event -> String.valueOf(event.getPayload().get("content"))))
                .containsExactly("你好，", "你好，世界");
        mockMvc.perform(get("/api/projects/{id}/snapshot", project.getId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.conversation_messages[1].content").value("你好，世界"))
                .andExpect(jsonPath("$.data.conversation_messages[1].status").value("completed"))
                .andExpect(jsonPath("$.data.conversation_messages[1].last_chunk_sequence").value(2));
    }

    @Test
    void retriesOutOfOrderAndDoubleCompleteRemainDeterministic() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("assistant-retry");
        projectMapper.insert(project);
        long runId = postMessage(project.getId()).path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String binding = binding(project.getId(), work);
        String streamId = "assistant-retry-" + runId;
        String start = "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"start-retry\"," + binding + "}";
        String chunk = "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-retry\",\"sequence_no\":1,"
                + "\"content\":\"稳定\",\"review_evidence\":{\"source\":\"local-fake\"},"
                + binding + "}";
        String complete = "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"complete-retry\",\"final_sequence_no\":1,"
                + "\"content_digest\":\"" + digest("稳定") + "\"," + binding + "}";

        postStream(runId, "start", "{\"stream_id\":\"oversized-key-stream\","
                + "\"idempotency_key\":\"" + "x".repeat(65) + "\"," + binding + "}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(100002))
                .andExpect(jsonPath("$.success").value(false));
        postStream(runId, "start", start).andExpect(status().isOk());
        postStream(runId, "start", start).andExpect(status().isOk());
        postStream(runId, "chunks", chunk).andExpect(status().isOk());
        postStream(runId, "chunks", chunk).andExpect(status().isOk());
        postStream(runId, "chunks", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-retry\",\"sequence_no\":1,"
                + "\"content\":\"改变重试内容\"," + binding + "}")
                .andExpect(status().isConflict());
        postStream(runId, "chunks", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-gap\",\"sequence_no\":3,"
                + "\"content\":\"乱序\"," + binding + "}")
                .andExpect(status().isConflict());
        postStream(runId, "complete", complete).andExpect(status().isOk());
        postStream(runId, "complete", complete).andExpect(status().isOk());
        postStream(runId, "complete", complete.replace(
                "complete-retry", "complete-different-key"))
                .andExpect(status().isConflict());
        postStream(runId, "chunks", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-after\",\"sequence_no\":2,"
                + "\"content\":\"禁止\"," + binding + "}")
                .andExpect(status().isConflict());

        assertThat(eventTypes(project.getId()).stream()
                .filter("conversation.message_started"::equals).count()).isEqualTo(1);
        assertThat(eventTypes(project.getId()).stream()
                .filter("conversation.message_chunk_appended"::equals).count()).isEqualTo(1);
        assertThat(eventTypes(project.getId()).stream()
                .filter("conversation.message_completed"::equals).count()).isEqualTo(1);
    }

    @Test
    void chunksWithoutPrefixEvidenceStayPrivateUntilWholeTextReview() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("assistant-buffered");
        projectMapper.insert(project);
        long runId = postMessage(project.getId()).path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String binding = binding(project.getId(), work);
        String streamId = "assistant-buffered-" + runId;
        String completeKey = "assistant-" + "e".repeat(54);

        postStream(runId, "start", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"start-buffered\"," + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "chunks", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-buffered\",\"sequence_no\":1,"
                + "\"content\":\"等待全文审核\"," + binding + "}")
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/projects/{id}/snapshot", project.getId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.conversation_messages[1].content").value(""))
                .andExpect(jsonPath("$.data.conversation_messages[1].status").value("streaming"));
        assertThat(eventTypes(project.getId()))
                .doesNotContain("conversation.message_chunk_appended");

        postStream(runId, "complete", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"" + completeKey + "\",\"final_sequence_no\":1,"
                + "\"content_digest\":\"" + digest("等待全文审核") + "\"," + binding + "}")
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/projects/{id}/snapshot", project.getId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.conversation_messages[1].content").value("等待全文审核"))
                .andExpect(jsonPath("$.data.conversation_messages[1].status").value("completed"));
    }

    @Test
    void laterEvidenceCannotReleaseTextAcrossAnUnreviewedPrefixGap() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("assistant-prefix-gap");
        projectMapper.insert(project);
        long runId = postMessage(project.getId()).path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String binding = binding(project.getId(), work);
        String streamId = "assistant-prefix-gap-" + runId;

        postStream(runId, "start", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"start-gap\"," + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "chunks", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-gap-1\",\"sequence_no\":1,"
                + "\"content\":\"私有\"," + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "chunks", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-gap-2\",\"sequence_no\":2,"
                + "\"content\":\"尾部\",\"review_evidence\":{\"source\":\"local-fake\"},"
                + binding + "}")
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/projects/{id}/snapshot", project.getId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.conversation_messages[1].content").value(""));
        assertThat(eventTypes(project.getId()))
                .doesNotContain("conversation.message_chunk_appended");

        postStream(runId, "complete", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"complete-gap\",\"final_sequence_no\":2,"
                + "\"content_digest\":\"" + digest("私有尾部") + "\"," + binding + "}")
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/projects/{id}/snapshot", project.getId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.conversation_messages[1].content").value("私有尾部"));
    }

    @Test
    void rejectedChunkIsDiscardedPrivatelyAndNeverReleased() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("assistant-rejected");
        projectMapper.insert(project);
        long runId = postMessage(project.getId()).path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String binding = binding(project.getId(), work);
        String streamId = "assistant-rejected-" + runId;
        String rejectedChunk = "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-rejected\",\"sequence_no\":1,"
                + "\"content\":\"fake:review-reject\","
                + "\"review_evidence\":{\"source\":\"local-fake\"}," + binding + "}";

        postStream(runId, "start", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"start-rejected\"," + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "chunks", rejectedChunk)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.data.code").value("CONTENT_REJECTED"));
        postStream(runId, "chunks", rejectedChunk)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.data.code").value("CONTENT_REJECTED"));

        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM assistant_message_chunks WHERE content = ?",
                Long.class, "fake:review-reject")).isZero();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT content FROM assistant_message_chunks WHERE assistant_message_stream_id = "
                        + "(SELECT id FROM assistant_message_streams WHERE stream_id = ?)",
                String.class, streamId)).isEmpty();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM assistant_message_streams WHERE stream_id = ?",
                String.class, streamId)).isEqualTo("rejected");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM conversation_messages WHERE content LIKE '%fake:review-reject%'",
                Long.class)).isZero();
        // 拒绝封口：消息置 rejected 终态并发封口事件，不留"生成中"残影。
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM conversation_messages WHERE stream_id = ?",
                String.class, streamId)).isEqualTo("rejected");
        assertThat(eventTypes(project.getId()))
                .doesNotContain("conversation.message_chunk_appended");
        assertThat(eventTypes(project.getId()).stream()
                .filter("conversation.message_completed"::equals).count()).isEqualTo(1);
    }

    @Test
    void unavailableFullReviewKeepsBufferForSameKeyRetry() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("assistant-unavailable");
        projectMapper.insert(project);
        long runId = postMessage(project.getId()).path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String binding = binding(project.getId(), work);
        String streamId = "assistant-unavailable-" + runId;
        String unavailableComplete = "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"complete-unavailable\",\"final_sequence_no\":1,"
                + "\"content_digest\":\"" + digest("fake:review-unavailable") + "\"," + binding + "}";

        postStream(runId, "start", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"start-unavailable\"," + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "chunks", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-unavailable\",\"sequence_no\":1,"
                + "\"content\":\"fake:review-unavailable\"," + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "complete", unavailableComplete)
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.data.code").value("CONTENT_REVIEW_UNAVAILABLE"));

        // 审核失败不毁缓冲：原文保留、消息未封口，等审核恢复后同键重试。
        assertThat(jdbcTemplate.queryForObject(
                "SELECT content FROM assistant_message_chunks WHERE assistant_message_stream_id = "
                        + "(SELECT id FROM assistant_message_streams WHERE stream_id = ?)",
                String.class, streamId)).isEqualTo("fake:review-unavailable");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM assistant_message_streams WHERE stream_id = ?",
                String.class, streamId)).isEqualTo("review_failed");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM conversation_messages WHERE stream_id = ? AND is_delete = 0",
                String.class, streamId)).isEqualTo("streaming");

        // 同一幂等键重试：审核仍不可用 → 再次 503，缓冲不被二次破坏。
        postStream(runId, "complete", unavailableComplete)
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.data.code").value("CONTENT_REVIEW_UNAVAILABLE"));
        assertThat(jdbcTemplate.queryForObject(
                "SELECT content FROM assistant_message_chunks WHERE assistant_message_stream_id = "
                        + "(SELECT id FROM assistant_message_streams WHERE stream_id = ?)",
                String.class, streamId)).isEqualTo("fake:review-unavailable");

        // 不同幂等键不是重试，按幂等冲突拒绝。
        postStream(runId, "complete", unavailableComplete.replace(
                "complete-unavailable", "complete-different-key"))
                .andExpect(status().isConflict());
    }

    @Test
    void terminalCommitReusesCompletedStreamMessageWithoutDuplicateEvent() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("assistant-commit");
        projectMapper.insert(project);
        long runId = postMessage(project.getId()).path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String binding = binding(project.getId(), work);
        String streamId = "assistant-commit-" + runId;
        String text = "已接纳，正在生成图片。";

        postStream(runId, "start", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"start-commit\"," + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "chunks", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-commit\",\"sequence_no\":1,"
                + "\"content\":\"" + text + "\","
                + "\"review_evidence\":{\"source\":\"local-fake\"}," + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "complete", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"complete-commit\",\"final_sequence_no\":1,"
                + "\"content_digest\":\"" + digest(text) + "\"," + binding + "}")
                .andExpect(status().isOk());

        mockMvc.perform(post("/internal/agent-runs/{id}/commits", runId)
                        .header("X-Worker-Id", "stream-worker")
                        .contentType("application/json")
                        .content("{\"commit_id\":\"commit-stream\","
                                + "\"assistant_message_stream_id\":\"" + streamId + "\","
                                + binding + ",\"visible_text\":\"" + text + "\","
                                + "\"checkpoint\":{\"opaque_payload\":{\"step\":\"proposed\"}},"
                                + "\"actions\":[{\"action_id\":\"action-stream\","
                                + "\"tool_id\":\"create_image_generation_job\",\"registry_version\":1,"
                                + "\"arguments\":{\"prompt\":\"蓝鲸海报\","
                                + "\"aspect_ratio\":\"1:1\"}}]}"))
                .andExpect(status().isOk());

        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM conversation_messages WHERE project_id = ? AND role = 'assistant'",
                Long.class, project.getId())).isEqualTo(1L);
        assertThat(eventTypes(project.getId()).stream()
                .filter("conversation.message_completed"::equals).count()).isEqualTo(1);
    }

    @Test
    void oversizedStreamIdIsRejectedAtProductApiLayer() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("assistant-stream-id-cap");
        projectMapper.insert(project);
        long runId = postMessage(project.getId()).path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String binding = binding(project.getId(), work);

        // stream_id 超长（>64）与 idempotency_key 同在 Product API 层被拒（100002 PARAM_BIND_ERROR）。
        postStream(runId, "start", "{\"stream_id\":\"" + "s".repeat(65) + "\","
                + "\"idempotency_key\":\"start-oversized-stream\"," + binding + "}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(100002))
                .andExpect(jsonPath("$.success").value(false));
    }
}
