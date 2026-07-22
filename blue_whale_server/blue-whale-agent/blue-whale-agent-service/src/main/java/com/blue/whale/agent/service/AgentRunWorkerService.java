package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.AgentRunMapper;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.AssistantMessageStreamMapper;
import com.blue.whale.agent.mapper.ConversationMapper;
import com.blue.whale.agent.mapper.ConversationMessageMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.GenerationJobOutputMapper;
import com.blue.whale.agent.mapper.GenerationModelCapabilityMapper;
import com.blue.whale.agent.mapper.RunCommitRecordMapper;
import com.blue.whale.agent.mapper.RuntimeCheckpointMapper;
import com.blue.whale.agent.mapper.UserInputRequestMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.dto.CanvasNodeSummary;
import com.blue.whale.agent.model.dto.RunCommitRequest;
import com.blue.whale.agent.model.dto.RunCommitResponse;
import com.blue.whale.agent.model.dto.RunWorkResponse;
import com.blue.whale.agent.model.dto.UserInputRequestProposal;
import com.blue.whale.agent.model.entity.AgentRun;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.AssistantMessageStream;
import com.blue.whale.agent.model.entity.Conversation;
import com.blue.whale.agent.model.entity.ConversationMessage;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.GenerationJobOutput;
import com.blue.whale.agent.model.entity.GenerationModelCapability;
import com.blue.whale.agent.model.entity.RunCommitRecord;
import com.blue.whale.agent.model.entity.RuntimeCheckpoint;
import com.blue.whale.agent.model.entity.UserInputRequest;
import com.blue.whale.agent.service.governance.AuditRecordWriter;
import com.blue.whale.agent.service.governance.ActionAuthorizationCommand;
import com.blue.whale.agent.service.governance.AuthorizationDecision;
import com.blue.whale.agent.service.governance.AuthorizationOutcome;
import com.blue.whale.agent.service.governance.GenerationActionAuthorizationService;
import com.blue.whale.agent.service.governance.GovernanceException;
import com.blue.whale.agent.service.governance.GenerationCostAdmissionService;
import com.blue.whale.agent.service.governance.CostReservationService;
import com.blue.whale.agent.service.governance.UserInputRequestService;
import com.blue.whale.agent.runtimebundle.RunToolGrantResolver;
import com.blue.whale.agent.runtimebundle.ToolArgumentValidator;
import com.blue.whale.agent.runtimebundle.ToolDefinition;
import com.blue.whale.agent.runtimebundle.ToolGrantScope;
import com.blue.whale.agent.runtimebundle.ToolRegistry;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.Collections;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;

@Service
@Slf4j
@RequiredArgsConstructor
public class AgentRunWorkerService {

    private static final String VIDEO_TOOL_ID = "create_video_generation_job";
    // IK2QC8：claim 下发的最近消息窗口（契约 §6.1），末尾若干条回到时间升序；更早历史由
    // read_conversation_history 游标分页按需读取。
    private static final int RECENT_MESSAGE_WINDOW = 6;
    // IK3BG2（ADR-0043）：agent_runs.error_code / error_message 列长（V15），截断兜底。
    private static final int ERROR_CODE_MAX_LENGTH = 96;
    private static final int ERROR_MESSAGE_MAX_LENGTH = 1024;

    private final AgentRunMapper agentRunMapper;
    private final ConversationMapper conversationMapper;
    private final ConversationMessageMapper messageMapper;
    private final AssistantMessageStreamMapper assistantMessageStreamMapper;
    private final RuntimeCheckpointMapper checkpointMapper;
    private final RunCommitRecordMapper runCommitMapper;
    private final GenerationJobMapper generationJobMapper;
    private final GenerationJobOutputMapper generationJobOutputMapper;
    private final UserInputRequestMapper userInputRequestMapper;
    private final AssetMapper assetMapper;
    private final ProjectService projectService;
    private final ProjectEventService projectEventService;
    private final GenerationActionAuthorizationService actionAuthorizationService;
    private final GenerationCostAdmissionService costAdmissionService;
    private final CostReservationService costReservationService;
    private final UserInputRequestService userInputRequestService;
    private final AuditRecordWriter auditRecordWriter;
    private final GenerationModelCapabilityMapper capabilityMapper;
    private final ObjectMapper objectMapper;
    private final ToolRegistry toolRegistry;
    private final RunToolGrantResolver runToolGrantResolver;
    private final ToolGrantScope toolGrantScope;
    private final ToolArgumentValidator toolArgumentValidator;
    // IK2QC8：claim 下发紧凑初始上下文（契约 §6.1）——复用 IK2QBZ / IK2QC7 只读查询服务，
    // 以 runId + workerId 经 requireLeasedRun 鉴权（claim 已取得租约），二者仅依赖
    // guard / mapper / CanvasService / RuntimeBundleService，无循环依赖。
    private final ConversationQueryService conversationQueryService;
    private final CreativeContextQueryService creativeContextQueryService;

    @Transactional(noRollbackFor = ClaimQueueExhaustedAfterQuarantine.class)
    public RunWorkResponse claim(String workerId, String engine) {
        requireWorker(workerId);
        requireEngine(engine);
        boolean quarantined = false;
        while (true) {
            AgentRun run = agentRunMapper.selectNextQueuedForUpdate(engine);
            if (run == null) {
                if (quarantined) {
                    throw new ClaimQueueExhaustedAfterQuarantine();
                }
                throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "暂无可认领 AgentRun");
            }
            RuntimeCheckpoint checkpoint;
            boolean checkpointValid;
            if (run.getCurrentCheckpointId() != null) {
                checkpoint = checkpointMapper.selectById(run.getCurrentCheckpointId());
                checkpointValid = checkpointMatches(run, checkpoint);
            } else if (run.getConfirmedInputRequestId() != null) {
                // resumed run 首轮认领：携带来源流程已接纳的 RuntimeCheckpoint。
                checkpoint = resumeCheckpoint(run);
                checkpointValid = checkpoint != null;
            } else {
                checkpoint = null;
                checkpointValid = true;
            }
            if (!checkpointValid) {
                quarantine(run);
                quarantined = true;
                continue;
            }
            LocalDateTime databaseNow = agentRunMapper.selectCurrentTime();
            run.setStatus(AgentRun.STATUS_RUNNING)
                    .setStage("orchestrating")
                    .setLeaseOwner(workerId)
                    .setLeaseExpiresAt(databaseNow.plusSeconds(30))
                    .setFencingToken(run.getFencingToken() + 1);
            agentRunMapper.updateById(run);
            run = agentRunMapper.selectById(run.getId());

            projectEventService.appendEvent(run.getProjectId(), EventType.AGENT_RUN_STATUS_CHANGED,
                    AggregateType.AGENT_RUN, String.valueOf(run.getId()), run.getVersion(),
                    runPayload(run), null, null);

            List<ConversationMessage> recent = messageMapper.selectList(
                    Wrappers.<ConversationMessage>lambdaQuery()
                            .eq(ConversationMessage::getConversationId, run.getConversationId())
                            .orderByDesc(ConversationMessage::getSequenceNo)
                            .last("LIMIT " + RECENT_MESSAGE_WINDOW));
            // LIMIT 取末尾窗口后反转回时间升序；空对话 → 空窗口，合法下发（契约 §6.1）。
            Collections.reverse(recent);
            List<RunWorkResponse.RunMessage> messages = recent.stream()
                    .map(message -> new RunWorkResponse.RunMessage(message.getRole(), message.getContent()))
                    .toList();
            List<RunWorkResponse.AcceptedResult> acceptedResults = acceptedResults(run, checkpoint);
            return new RunWorkResponse(
                    run.getId(), run.getProjectId(), run.getConversationId(), run.getUserId(),
                    run.getVersion(), run.getFencingToken(), run.getEngine(), run.getEngineVersion(),
                    run.getAdapterSchemaVersion(), run.getBundleVersionId(), run.getManifestDigest(),
                    run.getModelProfileId(), run.getModelProfileVersion(),
                    creativeSkillVersions(run.getActivatedCreativeSkillVersions()), messages,
                    checkpoint == null ? null
                            : new RunWorkResponse.Checkpoint(
                                    checkpoint.getId(), checkpoint.getEngine(), checkpoint.getEngineVersion(),
                                    checkpoint.getAdapterSchemaVersion(), checkpoint.getOpaquePayload()),
                    acceptedResults,
                    run.getToolGrants(),
                    conversationQueryService.summary(run.getId(), workerId),
                    mediaCanvasNodes(run.getId(), workerId));
        }
    }

    @Transactional
    public RunCommitResponse commit(Long runId, String workerId, RunCommitRequest request) {
        requireWorker(workerId);
        AgentRun run = agentRunMapper.selectForUpdate(runId);
        if (run == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        String requestHash = requestDigest(request);
        RunCommitRecord existing = runCommitMapper.selectOne(Wrappers.<RunCommitRecord>lambdaQuery()
                .eq(RunCommitRecord::getAgentRunId, runId)
                .eq(RunCommitRecord::getCommitId, request.commitId()));
        if (existing != null) {
            if (!requestHash.equals(existing.getRequestHash())) {
                throw new GlobalException(SystemCode.IDEMPOTENCY_KEY_REUSED_CODE,
                        SystemCode.IDEMPOTENCY_KEY_REUSED.getMsg());
            }
            return response(existing);
        }

        validateCommit(run, workerId, request, agentRunMapper.selectCurrentTime());
        // IK3AH2（契约 §6.4）：只读资源证据逐条落主 audit_records，与 commit 同事务共生共灭，
        // 写入失败 fail closed 回滚整个提交。幂等重放在上文 existing 分支已 return，不会重复落证据。
        persistBundleReadEvidence(run.getUserId(), run.getProjectId(), runId, request);
        projectService.requireOwnedForUpdate(run.getProjectId(), run.getUserId());
        UserInputRequestProposal proposal = request.userInputRequest();
        Map<String, Object> terminalError = request.error();
        // IK3BG2（ADR-0043）：恢复绑定的创作澄清在 commit 被接纳时即消费——恢复后可再澄清、
        // 修改方案或直接行动，回答已随工作包吸收，任何收场形态都算消费。成本确认仍只在动作
        // 分支按动作身份与报价严格消费。
        boolean boundClarificationConsumed = consumeBoundClarification(run);
        if (terminalError == null && proposal != null && !request.actions().isEmpty()) {
            // 提议与动作互斥：一次提交要么推进一个动作，要么提出一个输入请求。
            actionAuthorizationService.deny(
                    actionCommand(run, null, "unknown", false), "PROPOSAL_ACTION_MUTEX");
        }
        if (terminalError == null && proposal != null && hasActiveInputRequest(run)) {
            // 同时最多一个活动请求（pending/confirmed 且未过期未消费，两种 request_type 同规则），
            // 取代「每 Run 终生一次」：同一 AgentRun 顺序多轮澄清合法。
            actionAuthorizationService.deny(
                    actionCommand(run, null, "unknown", false), "ACTIVE_REQUEST_ALREADY_BOUND");
        }
        // IK3BG2（ADR-0043）：ACTION_MISSING 闸门退役——任何无动作、无输入请求提议、无错误的
        // commit 即合法完成（completed），契约级无条件放行、不限引擎与 checkpoint 形态。
        RunCommitRequest.ProposedAction action = null;
        String actionType = null;
        AuthorizationDecision authorization = null;
        if (terminalError == null && proposal == null && !request.actions().isEmpty()) {
            try {
                ValidatedAction validated = validateAction(run, request.actions());
                action = validated.action();
                actionType = validated.actionType();
            } catch (GlobalException exception) {
                RunCommitRequest.ProposedAction proposed = request.actions().size() == 1
                        ? request.actions().get(0) : null;
                actionAuthorizationService.deny(actionCommand(run, proposed, "unknown", false),
                        "ACTION_SCHEMA_OR_OWNERSHIP_REJECTED");
                throw exception;
            }
            boolean confirmed = run.getConfirmedInputRequestId() != null;
            if (confirmed && !boundClarificationConsumed) {
                userInputRequestService.consumeValidated(
                        run.getConfirmedInputRequestId(), run.getProjectId(), run.getUserId(), run.getId(),
                        action.actionId(), actionType, action.arguments());
            }
            authorization = actionAuthorizationService.authorize(
                    actionCommand(run, action, actionType, confirmed));
        }
        // IK2QBX 治理拒绝回喂：authorize DENIED 不再抛异常终结提交，
        // 投影为面向 User 的稳定 publicCode（不暴露内部 reasonCode），落 RunCommitRecord 经通道回喂。
        GovernanceException.RejectionEnvelope rejection = null;
        String rejectedActionId = null;
        if (authorization != null && authorization.outcome() == AuthorizationOutcome.DENIED) {
            rejection = GovernanceException.forDeniedReasonCode(authorization.reasonCode());
            rejectedActionId = action.actionId();
        }

        long checkpointCount = checkpointMapper.selectCount(Wrappers.<RuntimeCheckpoint>lambdaQuery()
                .eq(RuntimeCheckpoint::getAgentRunId, runId));
        RuntimeCheckpoint checkpoint = new RuntimeCheckpoint()
                .setAgentRunId(runId)
                .setSequenceNo(Math.toIntExact(checkpointCount + 1))
                .setRunVersion(request.expectedRunVersion() + 1)
                .setEngine(run.getEngine())
                .setEngineVersion(run.getEngineVersion())
                .setAdapterSchemaVersion(run.getAdapterSchemaVersion())
                .setPayloadDigest(checkpointDigest(request.checkpoint().opaquePayload()))
                .setOpaquePayload(request.checkpoint().opaquePayload());
        checkpointMapper.insert(checkpoint);

        Conversation conversation = conversationMapper.selectForUpdate(run.getConversationId());
        if (conversation == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        ConversationMessage message;
        boolean streamedMessage = request.assistantMessageStreamId() != null
                && !request.assistantMessageStreamId().isBlank();
        if (streamedMessage) {
            AssistantMessageStream stream = assistantMessageStreamMapper.selectByStreamIdForUpdate(
                    request.assistantMessageStreamId());
            message = stream == null ? null : messageMapper.selectById(stream.getMessageId());
            boolean validStream = stream != null
                    && Objects.equals(stream.getAgentRunId(), runId)
                    && AssistantMessageStream.STATUS_COMPLETED.equals(stream.getStatus())
                    && message != null
                    && Objects.equals(message.getContent(), request.visibleText());
            if (!validStream) {
                throw new GlobalException(SystemCode.AGENT_RUN_CONFLICT_CODE,
                        SystemCode.AGENT_RUN_CONFLICT.getMsg());
            }
        } else {
            long messageCount = messageMapper.selectCount(Wrappers.<ConversationMessage>lambdaQuery()
                    .eq(ConversationMessage::getConversationId, conversation.getId()));
            message = new ConversationMessage()
                    .setConversationId(conversation.getId())
                    .setProjectId(run.getProjectId())
                    .setAgentRunId(runId)
                    .setRole(ConversationMessage.ROLE_ASSISTANT)
                    .setContent(request.visibleText())
                    .setSequenceNo(Math.toIntExact(messageCount + 1));
            messageMapper.insert(message);
        }

        UserInputRequest inputRequest = null;
        GenerationJob job = null;
        if (terminalError == null && proposal != null) {
            // IK3AH2：澄清提议服务端 grant 复验——未授予 request_user_input 的 Run 不能发起创作澄清，
            // 投影为软回喂（run queued/awaiting_retry，accepted_results 回喂 rejected），堵住绕过动作路径
            // grant 铁闸的盲点。bundleVersionId 空（enforcement=false）时保持现状（测试 / 降级路径）。
            if (run.getBundleVersionId() != null && !run.getBundleVersionId().isBlank()
                    && runToolGrantResolver.resolve(run.getBundleVersionId(), "request_user_input", 1)
                            .isEmpty()) {
                rejectedActionId = "clarification:" + runId;
                auditRecordWriter.appendDeniedActionDecision(
                        new ActionAuthorizationCommand(
                                run.getUserId(), run.getProjectId(), "AgentRun", String.valueOf(runId),
                                "agent-run:" + runId, "clarification:" + runId, "request_user_input",
                                Map.of(), false, false),
                        "CLARIFICATION_TOOL_NOT_GRANTED", null, "runtime-bundle-grant");
                rejection = GovernanceException.forDeniedReasonCode("CLARIFICATION_TOOL_NOT_GRANTED");
            } else {
                // 创作澄清提议：原子保存 RuntimeCheckpoint（已在上文插入）与 UserInputRequest，
                // 令来源 AgentRun 进入等待输入状态并释放租约。无动作、无报价。
                inputRequest = userInputRequestService.createCreationClarification(
                        run.getProjectId(), run.getUserId(), conversation.getId(), runId,
                        proposal.question());
            }
        } else if (action != null && authorization.outcome() == AuthorizationOutcome.INPUT_REQUIRED) {
            inputRequest = userInputRequestService.create(
                    run.getProjectId(), run.getUserId(), run.getConversationId(), runId,
                    action.actionId(), actionType, action.arguments(), authorization.quote());
        } else if (action != null && rejection == null) {
            boolean isVideo = VIDEO_TOOL_ID.equals(action.toolId());
            LinkedHashMap<String, Object> input = new LinkedHashMap<>(action.arguments());
            input.put("expected_output_count", 1);
            String strategyVersion;
            Integer progress;
            LocalDateTime databaseNow = generationJobMapper.selectCurrentTime();
            LocalDateTime evidenceReconcileUntil = null;
            if (isVideo) {
                // 视频不暴露模型选择：参数已在 validateAction 经注册表 schema 校验，对称 BottomDock video 段。
                strategyVersion = "seedance-2.0-v1";
                progress = null;
                evidenceReconcileUntil = databaseNow.plusHours(24);
            } else {
                // Agent 不暴露模型选择：按能力表默认 image 模型注入 model_id 并校验/规范化 size，
                // 对称 BottomDock fail-early（reserveAuthorized 之前），非法 size 不产生 cost 预留（IK21O5）
                GenerationModelCapability capability = resolveAgentImageCapability();
                input.put("model_id", capability.getModelId());
                Object sizeArg = input.get("size");
                if (sizeArg instanceof String sizeValue && !sizeValue.isBlank()) {
                    GenerationModelCapability.SizeOption sizeOption = capability.findSizeById(sizeValue);
                    if (sizeOption == null) {
                        throw new GlobalException(SystemCode.AGENT_ACTION_REJECTED_CODE,
                                SystemCode.AGENT_ACTION_REJECTED.getMsg());
                    }
                    input.put("size", sizeOption.getId());
                }
                strategyVersion = "image-sync-v1";
                progress = 0;
            }
            job = new GenerationJob()
                    .setProjectId(run.getProjectId())
                    .setUserId(run.getUserId())
                    .setAgentRunId(runId)
                    .setActionIdentity(action.actionId())
                    .setProjectActionIdentity(action.actionId())
                    .setType(isVideo ? GenerationJob.TYPE_VIDEO : GenerationJob.TYPE_IMAGE)
                    .setSource(GenerationJob.SOURCE_AGENT_RUN)
                    .setExpectedOutputCount(1)
                    .setInput(input)
                    .setStatus(GenerationJob.STATUS_QUEUED)
                    .setProgress(progress)
                    .setFencingToken(0L)
                    .setStrategyVersion(strategyVersion)
                    .setExecutionDeadlineAt(databaseNow.plusMinutes(30))
                    .setEvidenceReconcileUntil(evidenceReconcileUntil)
                    .setNextActionAt(databaseNow);
            generationJobMapper.insert(job);
            costAdmissionService.reserveAuthorized(
                    run.getUserId(), run.getProjectId(), job.getId(), action.actionId(),
                    actionType, authorization.quote());
            generationJobOutputMapper.insert(new GenerationJobOutput()
                    .setGenerationJobId(job.getId())
                    .setSlotIndex(0)
                    .setStatus(GenerationJobOutput.STATUS_PENDING));
        }

        if (!streamedMessage) {
            Map<String, Object> messagePayload = new LinkedHashMap<>();
            messagePayload.put("message_id", message.getId());
            messagePayload.put("conversation_id", conversation.getId());
            messagePayload.put("agent_run_id", runId);
            messagePayload.put("role", message.getRole());
            messagePayload.put("content", message.getContent());
            messagePayload.put("sequence_no", message.getSequenceNo());
            projectEventService.appendEvent(run.getProjectId(), EventType.CONVERSATION_MESSAGE_COMPLETED,
                    AggregateType.CONVERSATION, String.valueOf(conversation.getId()), message.getSequenceNo(),
                    messagePayload, request.commitId(), null);
        }

        if (job != null) {
            Map<String, Object> jobPayload = new LinkedHashMap<>();
            jobPayload.put("job_id", job.getId());
            jobPayload.put("agent_run_id", runId);
            jobPayload.put("action_identity", job.getActionIdentity());
            jobPayload.put("type", job.getType());
            jobPayload.put("source", job.getSource());
            jobPayload.put("status", job.getStatus());
            jobPayload.put("progress", job.getProgress());
            jobPayload.put("input", job.getInput());
            jobPayload.put("expected_output_count", job.getExpectedOutputCount());
            jobPayload.put("retry_of_job_id", job.getRetryOfJobId());
            jobPayload.put("outputs", List.of(Map.of(
                    "slot_index", 0,
                    "status", GenerationJobOutput.STATUS_PENDING)));
            projectEventService.appendEvent(run.getProjectId(), EventType.GENERATION_JOB_CREATED,
                    AggregateType.GENERATION_JOB, String.valueOf(job.getId()), job.getVersion(),
                    jobPayload, request.commitId(), null);
        }

        if (inputRequest != null) {
            boolean creationClarification = inputRequest.isCreationClarification();
            Map<String, Object> inputPayload = new LinkedHashMap<>();
            inputPayload.put("input_request_id", inputRequest.getId());
            inputPayload.put("agent_run_id", runId);
            inputPayload.put("request_type", inputRequest.getRequestType());
            if (creationClarification) {
                inputPayload.put("question", inputRequest.getQuestion());
            } else {
                inputPayload.put("action_identity", inputRequest.getActionIdentity());
                inputPayload.put("action_type", inputRequest.getActionType());
            }
            inputPayload.put("status", inputRequest.getStatus());
            inputPayload.put("expires_at", inputRequest.getExpiresAt());
            if (creationClarification) {
                // 创作澄清向 ADR-0016 §5 靠拢：UserInputRequest 归属 AgentRun，
                // 事件使用 AgentRun 聚合身份与版本。
                projectEventService.appendEvent(run.getProjectId(),
                        EventType.AGENT_RUN_USER_INPUT_REQUESTED,
                        AggregateType.AGENT_RUN, String.valueOf(runId), run.getVersion(),
                        inputPayload, request.commitId(), null);
            } else {
                // 成本确认沿用独立聚合事件，向后兼容现有 SSE 客户端。
                projectEventService.appendEvent(run.getProjectId(), EventType.USER_INPUT_REQUEST_CREATED,
                        AggregateType.USER_INPUT_REQUEST, String.valueOf(inputRequest.getId()), 0,
                        inputPayload, request.commitId(), null);
            }
        }

        run.setCurrentCheckpointId(checkpoint.getId())
                .setStatus(terminalError != null ? AgentRun.STATUS_FAILED
                        : rejection != null ? AgentRun.STATUS_QUEUED
                        : inputRequest != null ? AgentRun.STATUS_AWAITING_INPUT
                        : job == null ? AgentRun.STATUS_COMPLETED : AgentRun.STATUS_AWAITING_JOB)
                .setStage(terminalError != null ? "failed"
                        : rejection != null ? "awaiting_retry"
                        : inputRequest != null
                        ? (proposal != null ? "awaiting_clarification" : "awaiting_confirmation")
                        : (job == null ? "completed" : "generating"))
                // IK3BG2（ADR-0043）：error commit 接纳为 failed 终态——error_code/error_message
                // 原样持久化（Worker 侧脱敏契约维持），列长截断兜底；failed Run 不再被 claim/重放。
                .setErrorCode(terminalError == null ? null
                        : truncate(asText(terminalError.get("code")), ERROR_CODE_MAX_LENGTH))
                .setErrorMessage(terminalError == null ? null
                        : truncate(asText(terminalError.get("message")), ERROR_MESSAGE_MAX_LENGTH))
                .setLeaseOwner(null)
                .setLeaseExpiresAt(null);
        agentRunMapper.updateById(run);
        // updateById 的 NOT_NULL 字段策略下 setLeaseOwner(null) 不持久化：租约释放须显式置空，
        // 否则 awaiting_*/completed/failed Run 残留 lease_owner（状态过滤兜底，但不符「释放租约」口径）。
        releaseLease(runId);
        run = agentRunMapper.selectById(runId);
        projectEventService.appendEvent(run.getProjectId(), EventType.AGENT_RUN_STATUS_CHANGED,
                AggregateType.AGENT_RUN, String.valueOf(runId), run.getVersion(),
                runPayload(run), request.commitId(), null);

        RunCommitRecord committed = new RunCommitRecord()
                .setAgentRunId(runId)
                .setCommitId(request.commitId())
                .setRequestHash(requestHash)
                .setCheckpointId(checkpoint.getId())
                .setGenerationJobId(job == null ? null : job.getId())
                .setUserInputRequestId(inputRequest == null ? null : inputRequest.getId())
                .setRejectedActionId(rejectedActionId)
                .setRejectedPublicCode(rejection == null ? null : rejection.publicCode())
                .setRejectedMessage(rejection == null ? null : rejection.message())
                .setRejectedRetryable(rejection != null && rejection.retryable())
                .setCommittedCursor(projectEventService.highWatermark(run.getProjectId()));
        runCommitMapper.insert(committed);
        return response(committed);
    }

    private void validateCommit(
            AgentRun run,
            String workerId,
            RunCommitRequest request,
            LocalDateTime databaseNow) {
        boolean matches = run.getProjectId().equals(request.projectId())
                && run.getUserId().equals(request.userId())
                && run.getVersion().equals(request.expectedRunVersion())
                && run.getFencingToken().equals(request.fencingToken())
                && workerId.equals(run.getLeaseOwner())
                && AgentRun.STATUS_RUNNING.equals(run.getStatus())
                && run.getLeaseExpiresAt() != null
                && run.getLeaseExpiresAt().isAfter(databaseNow)
                && run.getEngine().equals(request.engine())
                && run.getEngineVersion().equals(request.engineVersion())
                && run.getAdapterSchemaVersion().equals(request.adapterSchemaVersion());
        if (!matches) {
            throw new GlobalException(SystemCode.AGENT_RUN_CONFLICT_CODE,
                    SystemCode.AGENT_RUN_CONFLICT.getMsg());
        }
    }

    private void persistBundleReadEvidence(
            Long userId, Long projectId, Long runId, RunCommitRequest request) {
        List<Map<String, Object>> evidence = request.bundleEvidence();
        if (evidence == null || evidence.isEmpty()) {
            return;
        }
        for (Map<String, Object> entry : evidence) {
            auditRecordWriter.appendBundleReadEvidence(
                    userId, projectId, runId, request.commitId(),
                    asText(entry.get("resource_id")),
                    asText(entry.get("origin")),
                    entry.get("revision"),
                    entry.get("content_digest"),
                    entry.get("token_estimate"));
        }
    }

    private static String asText(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private boolean checkpointMatches(AgentRun run, RuntimeCheckpoint checkpoint) {
        if (run.getCurrentCheckpointId() == null) {
            return true;
        }
        return checkpoint != null
                && Objects.equals(checkpoint.getId(), run.getCurrentCheckpointId())
                && Objects.equals(checkpoint.getAgentRunId(), run.getId())
                && checkpoint.getRunVersion() != null
                && checkpoint.getRunVersion() <= run.getVersion()
                && Objects.equals(checkpoint.getEngine(), run.getEngine())
                && Objects.equals(checkpoint.getEngineVersion(), run.getEngineVersion())
                && Objects.equals(checkpoint.getAdapterSchemaVersion(), run.getAdapterSchemaVersion())
                && Objects.equals(checkpoint.getPayloadDigest(), checkpointDigest(checkpoint.getOpaquePayload()));
    }

    /**
     * resumed run 首轮认领时解析来源流程当前已接纳的 RuntimeCheckpoint。
     *
     * <p>checkpoint 仍归属 source run（不复制行、不回写 resumed run 的 current_checkpoint_id），
     * 只随工作包跨 seam 传递且对 Java 保持不透明。engine、engine_version 与
     * adapter_schema_version 必须与 resumed run 匹配（resumed run 的三件套继承自 source
     * run），payload 摘要必须校验通过；任何缺失或不匹配都视为损坏，返回 null 交由认领循环隔离。
     */
    private RuntimeCheckpoint resumeCheckpoint(AgentRun run) {
        UserInputRequest request = userInputRequestMapper.selectById(run.getConfirmedInputRequestId());
        if (request == null || request.getSourceAgentRunId() == null) {
            return null;
        }
        AgentRun sourceRun = agentRunMapper.selectById(request.getSourceAgentRunId());
        if (sourceRun == null || sourceRun.getCurrentCheckpointId() == null) {
            return null;
        }
        RuntimeCheckpoint checkpoint = checkpointMapper.selectById(sourceRun.getCurrentCheckpointId());
        if (checkpoint == null
                || !Objects.equals(checkpoint.getAgentRunId(), sourceRun.getId())
                || checkpoint.getRunVersion() == null
                || checkpoint.getRunVersion() > sourceRun.getVersion()
                || !Objects.equals(checkpoint.getEngine(), run.getEngine())
                || !Objects.equals(checkpoint.getEngineVersion(), run.getEngineVersion())
                || !Objects.equals(checkpoint.getAdapterSchemaVersion(), run.getAdapterSchemaVersion())
                || !Objects.equals(checkpoint.getPayloadDigest(),
                        checkpointDigest(checkpoint.getOpaquePayload()))) {
            return null;
        }
        return checkpoint;
    }

    private void quarantine(AgentRun run) {
        run.setStatus(AgentRun.STATUS_RECOVERY_FAILED)
                .setStage("checkpoint_invalid")
                .setLeaseOwner(null)
                .setLeaseExpiresAt(null);
        agentRunMapper.updateById(run);
        AgentRun quarantined = agentRunMapper.selectById(run.getId());
        projectEventService.appendEvent(quarantined.getProjectId(), EventType.AGENT_RUN_STATUS_CHANGED,
                AggregateType.AGENT_RUN, String.valueOf(quarantined.getId()), quarantined.getVersion(),
                runPayload(quarantined), null, null);
    }

    private ValidatedAction validateAction(
            AgentRun run,
            List<RunCommitRequest.ProposedAction> actions) {
        if (actions.size() != 1) {
            throw new GlobalException(SystemCode.AGENT_ACTION_REJECTED_CODE,
                    "首版只接受单个生成动作");
        }
        RunCommitRequest.ProposedAction action = actions.get(0);
        ToolDefinition definition = toolRegistry
                .find(action.toolId(), action.registryVersion())
                .orElseThrow(() -> new GlobalException(SystemCode.AGENT_ACTION_REJECTED_CODE,
                        SystemCode.AGENT_ACTION_REJECTED.getMsg()));
        // Run 钉住 grants 服务端复验：enforcement=true（run.bundleVersionId 非空）时，工具必须被该
        // Run 的 Bundle 授权，且 grant 收窄（schemaNoWider/constraintsNoWider，复用既有铁闸）合法。
        if (run.getBundleVersionId() != null && !run.getBundleVersionId().isBlank()) {
            RunToolGrantResolver.ResolvedToolGrant grant = runToolGrantResolver
                    .resolve(run.getBundleVersionId(), action.toolId(), action.registryVersion())
                    .orElseThrow(() -> new GlobalException(SystemCode.AGENT_ACTION_REJECTED_CODE,
                            SystemCode.AGENT_ACTION_REJECTED.getMsg()));
            if (!toolGrantScope.schemaNoWider(grant.argumentSchema(), definition.inputSchema())
                    || !toolGrantScope.constraintsNoWider(grant.constraints(), definition.constraints())) {
                throw new GlobalException(SystemCode.AGENT_ACTION_REJECTED_CODE,
                        SystemCode.AGENT_ACTION_REJECTED.getMsg());
            }
        }
        // IK3AH2：参数校验单一事实源——注册表 inputSchema + constraints 驱动（替代手工白名单），
        // 覆盖 type/enum/minLength/maxLength/minimum/maximum/maxItems/items/additionalProperties 等，
        // prompt.maxLength:2000(image)/4000(video) 由 constraints 生效。违约抛 AGENT_ACTION_REJECTED，
        // 由 commit 上文 try/catch 统一 fail-closed。
        toolArgumentValidator.validate(action.arguments(), definition.inputSchema(), definition.constraints());
        Object referenceAssetIds = action.arguments().get("reference_asset_ids");
        if (action.actionId().length() > 128
                || (referenceAssetIds != null && !validReferenceAssetIds(run, referenceAssetIds))
                || generationJobMapper.selectCount(Wrappers.<GenerationJob>lambdaQuery()
                        .eq(GenerationJob::getProjectId, run.getProjectId())
                        .eq(GenerationJob::getProjectActionIdentity, action.actionId())) > 0) {
            throw new GlobalException(SystemCode.AGENT_ACTION_REJECTED_CODE,
                    SystemCode.AGENT_ACTION_REJECTED.getMsg());
        }
        return new ValidatedAction(action, definition.actionType());
    }

    /** Agent 路径不暴露模型选择：回落能力表第一行 enabled image 模型（能力表为唯一权威）。 */
    private GenerationModelCapability resolveAgentImageCapability() {
        return capabilityMapper.selectEnabledByCapabilityType(GenerationModelCapability.CAPABILITY_IMAGE)
                .stream()
                .findFirst()
                .orElseThrow(() -> new GlobalException(SystemCode.AGENT_ACTION_REJECTED_CODE,
                        SystemCode.AGENT_ACTION_REJECTED.getMsg()));
    }

    private boolean validReferenceAssetIds(AgentRun run, Object value) {
        if (!(value instanceof List<?> assetIds) || assetIds.isEmpty()) {
            return false;
        }
        for (Object assetId : assetIds) {
            if (!(assetId instanceof Number number)) {
                return false;
            }
            long longValue = number.longValue();
            if (longValue <= 0 || number.doubleValue() != (double) longValue) {
                return false;
            }
        }
        List<Long> ids = assetIds.stream().map(assetId -> ((Number) assetId).longValue())
                .distinct().toList();
        if (ids.size() != assetIds.size()) {
            return false;
        }
        List<Asset> assets = assetMapper.selectBatchIds(ids);
        return assets.size() == ids.size() && assets.stream().allMatch(asset ->
                Objects.equals(asset.getProjectId(), run.getProjectId())
                        && Objects.equals(asset.getUserId(), run.getUserId())
                        && Asset.TYPE_IMAGE.equals(asset.getType())
                        && Asset.STATUS_NORMAL.equals(asset.getStatus()));
    }

    private ActionAuthorizationCommand actionCommand(
            AgentRun run,
            RunCommitRequest.ProposedAction action,
            String actionType,
            boolean confirmed) {
        return new ActionAuthorizationCommand(
                run.getUserId(), run.getProjectId(), "AgentRun", String.valueOf(run.getId()),
                "agent-run:" + run.getId(),
                action == null ? "commit-with-invalid-actions" : action.actionId(),
                actionType,
                action == null || action.arguments() == null ? Map.of() : action.arguments(),
                false, confirmed);
    }

    private record ValidatedAction(RunCommitRequest.ProposedAction action, String actionType) {
    }

    private RunWorkResponse.AcceptedResult acceptedResult(GenerationJob job) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("job_id", job.getId());
        if (GenerationJob.STATUS_SUCCEEDED.equals(job.getStatus())
                || GenerationJob.STATUS_PARTIALLY_SUCCEEDED.equals(job.getStatus())) {
            result.put("asset_ids", job.getOutputAssetIds() == null ? List.of() : job.getOutputAssetIds());
        } else if (GenerationJob.STATUS_FAILED.equals(job.getStatus())) {
            result.put("error", GenerationPublicError.project(
                    job.getError() == null ? Map.of() : job.getError(),
                    job.getType(),
                    costReservationService.budgetEffect(job.getId()).wireValue()));
        } else {
            result.put("error", Map.of());
        }
        return new RunWorkResponse.AcceptedResult(job.getActionIdentity(), job.getStatus(), result);
    }

    private List<RunWorkResponse.AcceptedResult> acceptedResults(
            AgentRun run,
            RuntimeCheckpoint checkpoint) {
        if (checkpoint == null) {
            return List.of();
        }
        RunCommitRecord commit = runCommitMapper.selectOne(Wrappers.<RunCommitRecord>lambdaQuery()
                .eq(RunCommitRecord::getAgentRunId, run.getId())
                .eq(RunCommitRecord::getCheckpointId, checkpoint.getId()));
        if (commit == null) {
            return List.of();
        }
        if (commit.getRejectedActionId() != null) {
            // IK2QBX 拒绝结果：面向 User 的稳定公开码与安全提示，不暴露内部 reasonCode。
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("public_code", commit.getRejectedPublicCode());
            result.put("message", commit.getRejectedMessage());
            result.put("retryable", Boolean.TRUE.equals(commit.getRejectedRetryable()));
            return List.of(new RunWorkResponse.AcceptedResult(
                    commit.getRejectedActionId(), "rejected", result));
        }
        if (commit.getGenerationJobId() == null) {
            return List.of();
        }
        GenerationJob job = generationJobMapper.selectById(commit.getGenerationJobId());
        if (job == null
                || !Objects.equals(job.getAgentRunId(), run.getId())
                || !GenerationJob.SOURCE_AGENT_RUN.equals(job.getSource())
                || !(GenerationJob.STATUS_SUCCEEDED.equals(job.getStatus())
                        || GenerationJob.STATUS_PARTIALLY_SUCCEEDED.equals(job.getStatus())
                        || GenerationJob.STATUS_FAILED.equals(job.getStatus())
                        || GenerationJob.STATUS_CANCELLED.equals(job.getStatus()))) {
            return List.of();
        }
        return List.of(acceptedResult(job));
    }

    /**
     * IK2QC8：claim 下发的画布媒体节点（契约 §6.1）——复用 IK2QC7 listCanvasNodes，仅保留携带
     * {@code assetId} 的媒体节点，贴合「素材」语义并与 {@code read_asset} 白名单源 A 对齐。claim 已
     * 取得租约，内部 {@code requireLeasedRun} 通过；无画布 / 无媒体节点 → 空集，合法下发。
     */
    private List<CanvasNodeSummary> mediaCanvasNodes(Long runId, String workerId) {
        return creativeContextQueryService.listCanvasNodes(runId, workerId, null).nodes().stream()
                .filter(node -> node.assetId() != null)
                .toList();
    }

    /**
     * IK3BG2（ADR-0043）：resumed run 绑定的创作澄清在 commit 被接纳时消费——恢复后可再澄清、
     * 修改方案或直接行动，回答已随工作包吸收，任何收场形态（动作 / 再澄清 / 纯文本 / 错误终态）
     * 都算消费。成本确认绑定返回 false，仍由动作分支按动作身份与报价严格消费。
     *
     * @return 绑定的创作澄清已在本 commit 消费
     */
    private boolean consumeBoundClarification(AgentRun run) {
        Long requestId = run.getConfirmedInputRequestId();
        if (requestId == null) {
            return false;
        }
        UserInputRequest bound = userInputRequestMapper.selectById(requestId);
        if (bound == null || !bound.isCreationClarification()) {
            return false;
        }
        userInputRequestService.consumeValidated(
                requestId, run.getProjectId(), run.getUserId(), run.getId(), null, null, Map.of());
        return true;
    }

    /**
     * IK3BG2（ADR-0036 §4 口径）：当前 Run 是否仍有活动 UserInputRequest——活动 = pending /
     * confirmed 且未过期未消费，两种 request_type 同规则；覆盖来源为本 Run 的请求与经
     * confirmedInputRequestId 绑定到本 Run 的请求（创作澄清绑定已在 commit 入口消费，不会误伤
     * 顺序多轮澄清）。
     */
    private boolean hasActiveInputRequest(AgentRun run) {
        LocalDateTime now = userInputRequestMapper.selectCurrentTime();
        long sourced = userInputRequestMapper.selectCount(Wrappers.<UserInputRequest>lambdaQuery()
                .eq(UserInputRequest::getProjectId, run.getProjectId())
                .eq(UserInputRequest::getSourceAgentRunId, run.getId())
                .in(UserInputRequest::getStatus,
                        UserInputRequest.STATUS_PENDING, UserInputRequest.STATUS_CONFIRMED)
                .gt(UserInputRequest::getExpiresAt, now));
        if (sourced > 0) {
            return true;
        }
        Long boundId = run.getConfirmedInputRequestId();
        if (boundId == null) {
            return false;
        }
        UserInputRequest bound = userInputRequestMapper.selectById(boundId);
        return bound != null
                && (UserInputRequest.STATUS_PENDING.equals(bound.getStatus())
                        || UserInputRequest.STATUS_CONFIRMED.equals(bound.getStatus()))
                && bound.getExpiresAt() != null
                && bound.getExpiresAt().isAfter(now);
    }

    /** 显式置空租约列（updateById 的 NOT_NULL 字段策略不持久化 null）。 */
    private void releaseLease(Long runId) {
        agentRunMapper.update(null, Wrappers.<AgentRun>lambdaUpdate()
                .eq(AgentRun::getId, runId)
                .set(AgentRun::getLeaseOwner, null)
                .set(AgentRun::getLeaseExpiresAt, null));
    }

    /** 列长截断兜底：error_code / error_message 原样持久化，超长截断（ADR-0043）。 */
    private static String truncate(String value, int maxLength) {
        if (value == null || value.length() <= maxLength) {
            return value;
        }
        return value.substring(0, maxLength);
    }

    private Map<String, Object> runPayload(AgentRun run) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("agent_run_id", run.getId());
        payload.put("conversation_id", run.getConversationId());
        payload.put("status", run.getStatus());
        payload.put("stage", run.getStage());
        payload.put("engine", run.getEngine());
        payload.put("engine_version", run.getEngineVersion());
        payload.put("adapter_schema_version", run.getAdapterSchemaVersion());
        payload.put("bundle_version_id", run.getBundleVersionId());
        payload.put("manifest_digest", run.getManifestDigest());
        payload.put("model_profile_id", run.getModelProfileId());
        payload.put("model_profile_version", run.getModelProfileVersion());
        payload.put("activated_creative_skill_versions",
                creativeSkillVersions(run.getActivatedCreativeSkillVersions()));
        payload.put("current_checkpoint_id", run.getCurrentCheckpointId());
        return payload;
    }

    private Object creativeSkillVersions(String value) {
        if (value == null || value.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readTree(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("AgentRun 的 Creative Skill 版本钉住数据已损坏", exception);
        }
    }

    private RunCommitResponse response(RunCommitRecord record) {
        return new RunCommitResponse(
                record.getCheckpointId(), record.getGenerationJobId(), record.getUserInputRequestId(),
                record.getCommittedCursor());
    }

    private String digest(Object value) {
        try {
            byte[] serialized = objectMapper.writeValueAsBytes(value);
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(serialized));
        } catch (JsonProcessingException | NoSuchAlgorithmException exception) {
            throw new IllegalStateException("无法计算提交摘要", exception);
        }
    }

    private String checkpointDigest(Map<String, Object> payload) {
        return digest(canonicalize(payload));
    }

    private String requestDigest(RunCommitRequest request) {
        return digest(canonicalize(objectMapper.convertValue(request, Object.class)));
    }

    private Object canonicalize(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> canonical = new TreeMap<>();
            map.forEach((key, nested) -> canonical.put(String.valueOf(key), canonicalize(nested)));
            return canonical;
        }
        if (value instanceof List<?> list) {
            return list.stream().map(this::canonicalize).toList();
        }
        return value;
    }

    private void requireWorker(String workerId) {
        if (workerId == null || workerId.isBlank()) {
            throw new GlobalException(SystemCode.UNAUTHORIZED_CODE, "未认证");
        }
    }

    private void requireEngine(String engine) {
        if (engine == null || engine.isBlank()) {
            throw new GlobalException(SystemCode.PARAM_MISS_CODE, "缺少 X-Orchestrator-Engine");
        }
    }

    private static final class ClaimQueueExhaustedAfterQuarantine extends GlobalException {
        private ClaimQueueExhaustedAfterQuarantine() {
            super(SystemCode.RESOURCE_NOT_FOUND_CODE, "损坏 AgentRun 已隔离，暂无其他可认领任务");
        }
    }
}
