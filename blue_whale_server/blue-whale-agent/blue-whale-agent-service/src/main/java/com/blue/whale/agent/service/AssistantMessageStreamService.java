package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.AgentRunMapper;
import com.blue.whale.agent.mapper.AssistantMessageChunkMapper;
import com.blue.whale.agent.mapper.AssistantMessageStreamMapper;
import com.blue.whale.agent.mapper.ConversationMessageMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.dto.AssistantMessageStreamRequests;
import com.blue.whale.agent.model.dto.AssistantMessageStreamResponse;
import com.blue.whale.agent.model.entity.AgentRun;
import com.blue.whale.agent.model.entity.AssistantMessageChunk;
import com.blue.whale.agent.model.entity.AssistantMessageStream;
import com.blue.whale.agent.model.entity.ConversationMessage;
import com.blue.whale.agent.service.governance.AgentTextReviewRequest;
import com.blue.whale.agent.service.governance.BudgetEffect;
import com.blue.whale.agent.service.governance.ContentReviewOutcome;
import com.blue.whale.agent.service.governance.ContentReviewService;
import com.blue.whale.agent.service.governance.GovernanceException;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

@Service
@RequiredArgsConstructor
public class AssistantMessageStreamService {

    private final AgentRunMapper agentRunMapper;
    private final AssistantMessageStreamMapper streamMapper;
    private final AssistantMessageChunkMapper chunkMapper;
    private final ConversationMessageMapper messageMapper;
    private final ProjectService projectService;
    private final ProjectEventService projectEventService;
    private final ContentReviewService contentReviewService;

    @Transactional
    public AssistantMessageStreamResponse start(
            Long runId, String workerId, AssistantMessageStreamRequests.Start request) {
        AgentRun run = requireBoundRun(runId, workerId, request.binding());
        AssistantMessageStream existing = streamMapper.selectByStreamIdForUpdate(request.streamId());
        if (existing != null) {
            if (!Objects.equals(existing.getAgentRunId(), runId)
                    || !Objects.equals(existing.getStartIdempotencyKey(), request.idempotencyKey())) {
                throw idempotencyReused();
            }
            return response(existing);
        }
        AssistantMessageStream runStream = streamMapper.selectOne(
                Wrappers.<AssistantMessageStream>lambdaQuery()
                        .eq(AssistantMessageStream::getAgentRunId, runId));
        if (runStream != null) {
            throw idempotencyReused();
        }
        projectService.requireOwnedForUpdate(run.getProjectId(), run.getUserId());
        long messageCount = messageMapper.selectCount(Wrappers.<ConversationMessage>lambdaQuery()
                .eq(ConversationMessage::getConversationId, run.getConversationId()));
        ConversationMessage message = new ConversationMessage()
                .setConversationId(run.getConversationId())
                .setProjectId(run.getProjectId())
                .setAgentRunId(runId)
                .setStreamId(request.streamId())
                .setRole(ConversationMessage.ROLE_ASSISTANT)
                .setContent("")
                .setStatus(AssistantMessageStream.STATUS_STREAMING)
                .setLastChunkSequence(0)
                .setSequenceNo(Math.toIntExact(messageCount + 1));
        messageMapper.insert(message);
        AssistantMessageStream stream = new AssistantMessageStream()
                .setStreamId(request.streamId())
                .setAgentRunId(runId)
                .setProjectId(run.getProjectId())
                .setConversationId(run.getConversationId())
                .setUserId(run.getUserId())
                .setMessageId(message.getId())
                .setStatus(AssistantMessageStream.STATUS_STREAMING)
                .setLastSequenceNo(0)
                .setReleasedSequenceNo(0)
                .setStartIdempotencyKey(request.idempotencyKey());
        streamMapper.insert(stream);
        long cursor = appendMessageEvent(
                stream, message, EventType.CONVERSATION_MESSAGE_STARTED,
                0, request.idempotencyKey());
        return response(stream, cursor);
    }

    @Transactional(noRollbackFor = GovernanceException.class)
    public AssistantMessageStreamResponse append(
            Long runId, String workerId, AssistantMessageStreamRequests.Chunk request) {
        requireBoundRun(runId, workerId, request.binding());
        AssistantMessageStream stream = requireStream(runId, request.streamId());
        AssistantMessageChunk sameSequence = chunkMapper.selectOne(
                Wrappers.<AssistantMessageChunk>lambdaQuery()
                        .eq(AssistantMessageChunk::getAssistantMessageStreamId, stream.getId())
                        .eq(AssistantMessageChunk::getSequenceNo, request.sequenceNo()));
        if (sameSequence != null) {
            if (!Objects.equals(sameSequence.getIdempotencyKey(), request.idempotencyKey())
                    || !Objects.equals(sameSequence.getContentDigest(), digest(request.content()))) {
                throw idempotencyReused();
            }
            if (AssistantMessageStream.STATUS_REJECTED.equals(stream.getStatus())
                    && stream.getCompleteIdempotencyKey() == null
                    && !Boolean.TRUE.equals(sameSequence.getReleased())) {
                throw contentRejected();
            }
            return response(stream);
        }
        AssistantMessageChunk sameKey = chunkMapper.selectOne(
                Wrappers.<AssistantMessageChunk>lambdaQuery()
                        .eq(AssistantMessageChunk::getAssistantMessageStreamId, stream.getId())
                        .eq(AssistantMessageChunk::getIdempotencyKey, request.idempotencyKey()));
        if (sameKey != null) {
            throw idempotencyReused();
        }
        requireStreaming(stream);
        if (request.sequenceNo() != stream.getLastSequenceNo() + 1) {
            throw conflict();
        }
        String digest = digest(request.content());
        AssistantMessageChunk chunk = new AssistantMessageChunk()
                .setAssistantMessageStreamId(stream.getId())
                .setSequenceNo(request.sequenceNo())
                .setIdempotencyKey(request.idempotencyKey())
                .setContent(request.content())
                .setContentDigest(digest)
                .setReleased(false);
        chunkMapper.insert(chunk);
        stream.setLastSequenceNo(request.sequenceNo());
        streamMapper.updateById(stream);

        if (request.reviewEvidence() == null) {
            return response(stream);
        }
        if (request.sequenceNo() != stream.getReleasedSequenceNo() + 1) {
            // OutputReleaseGate 只放行连续前缀；后来的证据不能跨过未审核缺口。
            return response(stream);
        }
        ContentReviewOutcome outcome = contentReviewService.reviewAgentText(
                new AgentTextReviewRequest(
                        stream.getProjectId(), stream.getUserId(), stream.getAgentRunId(),
                        stream.getStreamId(), chunkSubject(stream, chunk), chunk.getContent(),
                        chunk.getContentDigest(), request.reviewEvidence()));
        if (outcome.status() == ContentReviewOutcome.Status.FAILED) {
            return response(stream);
        }
        if (outcome.status() == ContentReviewOutcome.Status.REJECTED) {
            stream.setStatus(AssistantMessageStream.STATUS_REJECTED);
            streamMapper.updateById(stream);
            discardUnreleasedChunks(chunks(stream));
            closeMessageRejected(stream, requireMessage(stream), request.idempotencyKey());
            throw contentRejected();
        }
        ConversationMessage message = requireMessage(stream);
        message.setContent(message.getContent() + chunk.getContent())
                .setLastChunkSequence(chunk.getSequenceNo());
        messageMapper.updateById(message);
        chunk.setReleased(true);
        chunkMapper.updateById(chunk);
        stream.setReleasedSequenceNo(chunk.getSequenceNo());
        streamMapper.updateById(stream);
        long cursor = appendMessageEvent(
                stream, message, EventType.CONVERSATION_MESSAGE_CHUNK_APPENDED,
                chunk.getSequenceNo(), request.idempotencyKey());
        return response(stream, cursor);
    }

    @Transactional(noRollbackFor = GovernanceException.class)
    public AssistantMessageStreamResponse complete(
            Long runId, String workerId, AssistantMessageStreamRequests.Complete request) {
        requireBoundRun(runId, workerId, request.binding());
        AssistantMessageStream stream = requireStream(runId, request.streamId());
        if (!AssistantMessageStream.STATUS_STREAMING.equals(stream.getStatus())) {
            if (!sameCompletion(stream, request)) {
                throw idempotencyReused();
            }
            if (AssistantMessageStream.STATUS_REJECTED.equals(stream.getStatus())) {
                throw contentRejected();
            }
            if (AssistantMessageStream.STATUS_REVIEW_FAILED.equals(stream.getStatus())) {
                // 审核失败时缓冲与消息完整保留，同一幂等键重试 = 重新尝试整段审核与放行。
                return reviewReleaseAndClose(stream, request);
            }
            return response(stream);
        }
        if (!Objects.equals(stream.getLastSequenceNo(), request.finalSequenceNo())) {
            throw conflict();
        }
        return reviewReleaseAndClose(stream, request);
    }

    private AssistantMessageStreamResponse reviewReleaseAndClose(
            AssistantMessageStream stream, AssistantMessageStreamRequests.Complete request) {
        List<AssistantMessageChunk> chunks = chunks(stream);
        String fullContent = chunks.stream().map(AssistantMessageChunk::getContent)
                .reduce("", String::concat);
        if (!digest(fullContent).equals(request.contentDigest())) {
            throw conflict();
        }
        ConversationMessage message = requireMessage(stream);
        long cursor = 0L;
        if (stream.getReleasedSequenceNo() < stream.getLastSequenceNo()) {
            ContentReviewOutcome outcome = contentReviewService.reviewAgentText(
                    new AgentTextReviewRequest(
                            stream.getProjectId(), stream.getUserId(), stream.getAgentRunId(),
                            stream.getStreamId(), fullSubject(stream), fullContent,
                            request.contentDigest(), null));
            if (outcome.status() == ContentReviewOutcome.Status.REJECTED) {
                stream.setStatus(AssistantMessageStream.STATUS_REJECTED)
                        .setCompleteIdempotencyKey(request.idempotencyKey())
                        .setContentDigest(request.contentDigest());
                streamMapper.updateById(stream);
                discardUnreleasedChunks(chunks);
                closeMessageRejected(stream, message, request.idempotencyKey());
                throw contentRejected();
            }
            if (outcome.status() == ContentReviewOutcome.Status.FAILED) {
                // 保留全部缓冲与消息：审核恢复后可用同一幂等键重试 complete 重新放行。
                stream.setStatus(AssistantMessageStream.STATUS_REVIEW_FAILED)
                        .setCompleteIdempotencyKey(request.idempotencyKey())
                        .setContentDigest(request.contentDigest());
                streamMapper.updateById(stream);
                throw reviewUnavailable();
            }
            message.setContent(fullContent)
                    .setLastChunkSequence(stream.getLastSequenceNo());
            messageMapper.updateById(message);
            chunks.forEach(chunk -> {
                if (!Boolean.TRUE.equals(chunk.getReleased())) {
                    chunk.setReleased(true);
                    chunkMapper.updateById(chunk);
                }
            });
            stream.setReleasedSequenceNo(stream.getLastSequenceNo());
            streamMapper.updateById(stream);
            cursor = appendMessageEvent(
                    stream, message, EventType.CONVERSATION_MESSAGE_CHUNK_APPENDED,
                    stream.getLastSequenceNo(), request.idempotencyKey());
        }
        message.setStatus(AssistantMessageStream.STATUS_COMPLETED)
                .setLastChunkSequence(stream.getLastSequenceNo());
        messageMapper.updateById(message);
        stream.setStatus(AssistantMessageStream.STATUS_COMPLETED)
                .setCompleteIdempotencyKey(request.idempotencyKey())
                .setContentDigest(request.contentDigest());
        streamMapper.updateById(stream);
        cursor = appendMessageEvent(
                stream, message, EventType.CONVERSATION_MESSAGE_COMPLETED,
                stream.getLastSequenceNo() + 1, request.idempotencyKey());
        return response(stream, cursor);
    }

    private AgentRun requireBoundRun(
            Long runId, String workerId, AssistantMessageStreamRequests.RunBinding binding) {
        if (workerId == null || workerId.isBlank()) {
            throw new GlobalException(SystemCode.UNAUTHORIZED_CODE, "未认证");
        }
        AgentRun run = agentRunMapper.selectForUpdate(runId);
        if (run == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        boolean matches = Objects.equals(run.getProjectId(), binding.projectId())
                && Objects.equals(run.getUserId(), binding.userId())
                && Objects.equals(run.getVersion(), binding.expectedRunVersion())
                && Objects.equals(run.getFencingToken(), binding.fencingToken())
                && Objects.equals(run.getLeaseOwner(), workerId)
                && AgentRun.STATUS_RUNNING.equals(run.getStatus())
                && run.getLeaseExpiresAt() != null
                && run.getLeaseExpiresAt().isAfter(agentRunMapper.selectCurrentTime())
                && Objects.equals(run.getEngine(), binding.engine())
                && Objects.equals(run.getEngineVersion(), binding.engineVersion())
                && Objects.equals(run.getAdapterSchemaVersion(), binding.adapterSchemaVersion());
        if (!matches) {
            throw conflict();
        }
        return run;
    }

    private AssistantMessageStream requireStream(Long runId, String streamId) {
        AssistantMessageStream stream = streamMapper.selectByStreamIdForUpdate(streamId);
        if (stream == null || !Objects.equals(stream.getAgentRunId(), runId)) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        return stream;
    }

    private ConversationMessage requireMessage(AssistantMessageStream stream) {
        ConversationMessage message = messageMapper.selectById(stream.getMessageId());
        if (message == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        return message;
    }

    private List<AssistantMessageChunk> chunks(AssistantMessageStream stream) {
        return chunkMapper.selectList(Wrappers.<AssistantMessageChunk>lambdaQuery()
                .eq(AssistantMessageChunk::getAssistantMessageStreamId, stream.getId())
                .orderByAsc(AssistantMessageChunk::getSequenceNo));
    }

    private void discardUnreleasedChunks(List<AssistantMessageChunk> chunks) {
        chunks.forEach(chunk -> {
            if (!Boolean.TRUE.equals(chunk.getReleased()) && !chunk.getContent().isEmpty()) {
                chunk.setContent("");
                chunkMapper.updateById(chunk);
            }
        });
    }

    /**
     * 拒绝不删除消息：已放行前缀保留，消息置 rejected 终态并发封口事件，
     * 快照与事件重放都不会留下永远"生成中"的残影。
     */
    private void closeMessageRejected(
            AssistantMessageStream stream, ConversationMessage message, String correlationId) {
        message.setStatus(AssistantMessageStream.STATUS_REJECTED);
        messageMapper.updateById(message);
        appendMessageEvent(
                stream, message, EventType.CONVERSATION_MESSAGE_COMPLETED,
                stream.getLastSequenceNo() + 1, correlationId);
    }

    private boolean sameCompletion(
            AssistantMessageStream stream, AssistantMessageStreamRequests.Complete request) {
        return Objects.equals(stream.getCompleteIdempotencyKey(), request.idempotencyKey())
                && Objects.equals(stream.getContentDigest(), request.contentDigest())
                && Objects.equals(stream.getLastSequenceNo(), request.finalSequenceNo());
    }

    private long appendMessageEvent(
            AssistantMessageStream stream, ConversationMessage message, String eventType,
            int aggregateVersion, String correlationId) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("message_id", message.getId());
        payload.put("stream_id", stream.getStreamId());
        payload.put("conversation_id", message.getConversationId());
        payload.put("agent_run_id", stream.getAgentRunId());
        payload.put("role", message.getRole());
        payload.put("content", message.getContent());
        payload.put("sequence_no", message.getSequenceNo());
        payload.put("status", message.getStatus());
        payload.put("last_chunk_sequence", message.getLastChunkSequence());
        return projectEventService.appendEvent(
                stream.getProjectId(), eventType, AggregateType.CONVERSATION_MESSAGE,
                stream.getStreamId(), aggregateVersion, payload, correlationId, null).getCursor();
    }

    private AssistantMessageStreamResponse response(AssistantMessageStream stream) {
        return response(stream, projectEventService.highWatermark(stream.getProjectId()));
    }

    private AssistantMessageStreamResponse response(AssistantMessageStream stream, long cursor) {
        return new AssistantMessageStreamResponse(
                stream.getStreamId(), stream.getMessageId(), stream.getStatus(),
                stream.getLastSequenceNo(), stream.getReleasedSequenceNo(), cursor);
    }

    private String chunkSubject(AssistantMessageStream stream, AssistantMessageChunk chunk) {
        return "assistant-stream:" + stream.getStreamId() + ":chunk:" + chunk.getSequenceNo();
    }

    private String fullSubject(AssistantMessageStream stream) {
        return "assistant-stream:" + stream.getStreamId() + ":full";
    }

    private String digest(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private void requireStreaming(AssistantMessageStream stream) {
        if (!AssistantMessageStream.STATUS_STREAMING.equals(stream.getStatus())) {
            throw conflict();
        }
    }

    private GlobalException idempotencyReused() {
        return new GlobalException(
                SystemCode.IDEMPOTENCY_KEY_REUSED_CODE, SystemCode.IDEMPOTENCY_KEY_REUSED.getMsg());
    }

    private GlobalException conflict() {
        return new GlobalException(
                SystemCode.AGENT_RUN_CONFLICT_CODE, SystemCode.AGENT_RUN_CONFLICT.getMsg());
    }

    private GovernanceException contentRejected() {
        return new GovernanceException(
                "CONTENT_REJECTED", "内容未通过安全审核。", false, null, null,
                BudgetEffect.NONE, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    private GovernanceException reviewUnavailable() {
        return new GovernanceException(
                "CONTENT_REVIEW_UNAVAILABLE", "内容审核暂时不可用。", true, 1, null,
                BudgetEffect.NONE, HttpStatus.SERVICE_UNAVAILABLE);
    }
}
