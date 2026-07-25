package com.blue.whale.agent;

import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.service.governance.AgentTextReviewRequest;
import com.blue.whale.agent.service.governance.ReviewEvidence;
import com.blue.whale.agent.service.governance.ReviewEvidenceSource;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 审核失败恢复路径：可控证据源模拟「先不可用、后恢复」，验证同一幂等键重试
 * 能放行完整保留的缓冲文本（LocalFake 证据源由内容标记驱动，无法表达恢复）。
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
class AssistantMessageStreamReviewRetryIT extends AssistantMessageStreamITBase {

    @MockBean
    private ReviewEvidenceSource reviewEvidenceSource;

    @Test
    void sameKeyRetryReleasesBufferedTextAfterReviewRecovers() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("assistant-review-retry");
        projectMapper.insert(project);
        long runId = postMessage(project.getId()).path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String binding = binding(project.getId(), work);
        String streamId = "assistant-review-retry-" + runId;
        String text = "审核恢复后放行的完整文本";
        String complete = "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"complete-retry-recover\",\"final_sequence_no\":1,"
                + "\"content_digest\":\"" + digest(text) + "\"," + binding + "}";

        // 第一次审核不可用，第二次（同键重试）恢复通过。
        when(reviewEvidenceSource.produceAgentText(any(), any()))
                .thenAnswer(invocation -> evidence(
                        invocation.getArgument(0), invocation.getArgument(1), true))
                .thenAnswer(invocation -> evidence(
                        invocation.getArgument(0), invocation.getArgument(1), false));

        postStream(runId, "start", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"start-retry-recover\"," + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "chunks", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-retry-recover\",\"sequence_no\":1,"
                + "\"content\":\"" + text + "\"," + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "complete", complete)
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.data.code").value("CONTENT_REVIEW_UNAVAILABLE"));

        postStream(runId, "complete", complete)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.last_sequence_no").value(1));

        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM assistant_message_streams WHERE stream_id = ?",
                String.class, streamId)).isEqualTo("completed");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT review_state FROM content_reviews WHERE subject_type = 'agent_text'",
                String.class)).isEqualTo("decided");
        mockMvc.perform(get("/api/projects/{id}/snapshot", project.getId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.conversation_messages[1].content").value(text))
                .andExpect(jsonPath("$.data.conversation_messages[1].status").value("completed"));
        assertThat(eventTypes(project.getId())).containsSubsequence(
                "conversation.message_started",
                "conversation.message_chunk_appended",
                "conversation.message_completed");
    }

    @Test
    void rejectedCompletionKeepsReviewedPrefixAndClosesMessage() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("assistant-reject-close");
        projectMapper.insert(project);
        long runId = postMessage(project.getId()).path("agent_run_id").asLong();
        JsonNode work = claim(runId);
        String binding = binding(project.getId(), work);
        String streamId = "assistant-reject-close-" + runId;

        // 已放行前缀审 chunk 通过；含「危险」的全文整段审核拒绝。
        when(reviewEvidenceSource.produceAgentText(any(), any()))
                .thenAnswer(invocation -> {
                    AgentTextReviewRequest request = invocation.getArgument(0);
                    String policyVersion = invocation.getArgument(1);
                    if (request.content().contains("危险")) {
                        return ReviewEvidence.reject(
                                request.contentDigest(), "text", "output", policyVersion,
                                List.of("custom_policy"), "test-review");
                    }
                    return ReviewEvidence.pass(
                            request.contentDigest(), "text", "output",
                            policyVersion, "test-review");
                });

        postStream(runId, "start", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"start-reject-close\"," + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "chunks", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-reject-close-1\",\"sequence_no\":1,"
                + "\"content\":\"安全前缀\",\"review_evidence\":{\"source\":\"local-fake\"},"
                + binding + "}")
                .andExpect(status().isOk());
        postStream(runId, "chunks", "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"chunk-reject-close-2\",\"sequence_no\":2,"
                + "\"content\":\"危险尾部\"," + binding + "}")
                .andExpect(status().isOk());
        String rejectedComplete = "{\"stream_id\":\"" + streamId
                + "\",\"idempotency_key\":\"complete-reject-close\",\"final_sequence_no\":2,"
                + "\"content_digest\":\"" + digest("安全前缀危险尾部") + "\"," + binding + "}";
        postStream(runId, "complete", rejectedComplete)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.data.code").value("CONTENT_REJECTED"));
        // 同键重试拒绝仍是确定性的 CONTENT_REJECTED。
        postStream(runId, "complete", rejectedComplete)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.data.code").value("CONTENT_REJECTED"));

        // 已审核前缀保留在公开消息中，消息置 rejected 终态并发封口事件。
        mockMvc.perform(get("/api/projects/{id}/snapshot", project.getId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.conversation_messages[1].content").value("安全前缀"))
                .andExpect(jsonPath("$.data.conversation_messages[1].status").value("rejected"));
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM assistant_message_chunks WHERE content LIKE '%危险%'",
                Long.class)).isZero();
        assertThat(eventTypes(project.getId())).containsSubsequence(
                "conversation.message_started",
                "conversation.message_chunk_appended",
                "conversation.message_completed");
    }

    private ReviewEvidence evidence(
            AgentTextReviewRequest request, String policyVersion, boolean unavailable) {
        if (unavailable) {
            return ReviewEvidence.failed(
                    request.contentDigest(), "text", "output", policyVersion,
                    "unavailable", "test-review");
        }
        return ReviewEvidence.pass(
                request.contentDigest(), "text", "output", policyVersion, "test-review");
    }
}
