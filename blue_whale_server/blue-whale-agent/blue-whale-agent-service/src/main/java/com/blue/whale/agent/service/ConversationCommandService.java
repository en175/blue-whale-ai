package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.common.crypto.Sha256;
import com.blue.whale.agent.mapper.AgentRunMapper;
import com.blue.whale.agent.mapper.CommandIdempotencyMapper;
import com.blue.whale.agent.mapper.ConversationMapper;
import com.blue.whale.agent.mapper.ConversationMessageMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.config.AgentOrchestratorProperties;
import com.blue.whale.agent.model.dto.AcceptConversationMessageRequest;
import com.blue.whale.agent.model.dto.AcceptConversationMessageResponse;
import com.blue.whale.agent.model.entity.AgentRun;
import com.blue.whale.agent.model.entity.CommandIdempotency;
import com.blue.whale.agent.model.entity.Conversation;
import com.blue.whale.agent.model.entity.ConversationMessage;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.agent.service.governance.UserInputRequestService;
import com.blue.whale.agent.service.governance.PersistedUserInputDecisionException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class ConversationCommandService {

    private static final String OPERATION = "conversation.message.accept";

    private final ProjectService projectService;
    private final AgentOrchestratorProperties orchestratorProperties;
    private final ConversationMapper conversationMapper;
    private final ConversationMessageMapper messageMapper;
    private final AgentRunMapper agentRunMapper;
    private final CommandIdempotencyMapper idempotencyMapper;
    private final ProjectEventService projectEventService;
    private final UserInputRequestService userInputRequestService;

    @Transactional(noRollbackFor = PersistedUserInputDecisionException.class)
    public AcceptConversationMessageResponse accept(Long projectId, Long userId, String idempotencyKey,
                                                     AcceptConversationMessageRequest request) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new GlobalException(100000, "缺少 Idempotency-Key");
        }
        projectService.requireOwnedForUpdate(projectId, userId);
        String requestHash = requestHash(request);
        CommandIdempotency existing = idempotencyMapper.selectOne(
                Wrappers.<CommandIdempotency>lambdaQuery()
                        .eq(CommandIdempotency::getProjectId, projectId)
                        .eq(CommandIdempotency::getOperation, OPERATION)
                        .eq(CommandIdempotency::getIdempotencyKey, idempotencyKey));
        if (existing != null) {
            if (!requestHash.equals(existing.getRequestHash())) {
                throw new GlobalException(SystemCode.IDEMPOTENCY_KEY_REUSED_CODE,
                        SystemCode.IDEMPOTENCY_KEY_REUSED.getMsg());
            }
            return response(existing);
        }
        Long confirmedInputRequestId = request.replyToInputRequestId() == null ? null
                : userInputRequestService.confirm(
                        projectId, userId, request.replyToInputRequestId(), request.content());

        Conversation conversation = conversationMapper.selectOne(
                Wrappers.<Conversation>lambdaQuery().eq(Conversation::getProjectId, projectId));
        if (conversation == null) {
            conversation = new Conversation().setProjectId(projectId);
            conversationMapper.insert(conversation);
        }
        conversation = conversationMapper.selectForUpdate(conversation.getId());
        if (conversation == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }

        AgentRun run = new AgentRun()
                .setProjectId(projectId)
                .setConversationId(conversation.getId())
                .setUserId(userId)
                .setStatus(AgentRun.STATUS_QUEUED)
                .setStage("understanding")
                .setEngine(orchestratorProperties.getEngine())
                .setEngineVersion(orchestratorProperties.getEngineVersion())
                .setAdapterSchemaVersion(orchestratorProperties.getAdapterSchemaVersion())
                .setConfirmedInputRequestId(confirmedInputRequestId)
                .setFencingToken(0L);
        agentRunMapper.insert(run);
        if (confirmedInputRequestId != null) {
            userInputRequestService.bindResumedRun(confirmedInputRequestId, run.getId());
        }

        long messageCount = messageMapper.selectCount(Wrappers.<ConversationMessage>lambdaQuery()
                .eq(ConversationMessage::getConversationId, conversation.getId()));
        ConversationMessage message = new ConversationMessage()
                .setConversationId(conversation.getId())
                .setProjectId(projectId)
                .setAgentRunId(run.getId())
                .setClientMessageId(request.clientMessageId())
                .setRole(ConversationMessage.ROLE_USER)
                .setContent(request.content())
                .setSequenceNo(Math.toIntExact(messageCount + 1));
        messageMapper.insert(message);

        Map<String, Object> messagePayload = new LinkedHashMap<>();
        messagePayload.put("message_id", message.getId());
        messagePayload.put("conversation_id", conversation.getId());
        messagePayload.put("agent_run_id", run.getId());
        messagePayload.put("role", message.getRole());
        messagePayload.put("content", message.getContent());
        messagePayload.put("sequence_no", message.getSequenceNo());
        projectEventService.appendEvent(projectId, EventType.CONVERSATION_MESSAGE_ACCEPTED,
                AggregateType.CONVERSATION, String.valueOf(conversation.getId()), message.getSequenceNo(),
                messagePayload, request.clientMessageId(), null);

        Map<String, Object> runPayload = new LinkedHashMap<>();
        runPayload.put("agent_run_id", run.getId());
        runPayload.put("conversation_id", conversation.getId());
        runPayload.put("status", run.getStatus());
        runPayload.put("stage", run.getStage());
        runPayload.put("engine", run.getEngine());
        runPayload.put("engine_version", run.getEngineVersion());
        runPayload.put("adapter_schema_version", run.getAdapterSchemaVersion());
        projectEventService.appendEvent(projectId, EventType.AGENT_RUN_CREATED,
                AggregateType.AGENT_RUN, String.valueOf(run.getId()), 0,
                runPayload, request.clientMessageId(), null);

        long cursor = projectEventService.highWatermark(projectId);
        CommandIdempotency accepted = new CommandIdempotency()
                .setProjectId(projectId)
                .setOperation(OPERATION)
                .setIdempotencyKey(idempotencyKey)
                .setRequestHash(requestHash)
                .setMessageId(message.getId())
                .setAgentRunId(run.getId())
                .setAcceptedCursor(cursor);
        idempotencyMapper.insert(accepted);
        return response(accepted);
    }

    private AcceptConversationMessageResponse response(CommandIdempotency record) {
        return new AcceptConversationMessageResponse(
                record.getMessageId(), record.getAgentRunId(), record.getAcceptedCursor());
    }

    private String requestHash(AcceptConversationMessageRequest request) {
        String canonical = request.clientMessageId() + "\u0000" + request.content() + "\u0000"
                + String.valueOf(request.replyToInputRequestId());
        return Sha256.hex(canonical);
    }
}
