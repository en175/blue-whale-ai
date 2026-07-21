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
import com.blue.whale.agent.service.governance.ActionAuthorizationCommand;
import com.blue.whale.agent.service.governance.AuthorizationDecision;
import com.blue.whale.agent.service.governance.AuthorizationOutcome;
import com.blue.whale.agent.service.governance.GenerationActionAuthorizationService;
import com.blue.whale.agent.service.governance.GenerationCostAdmissionService;
import com.blue.whale.agent.service.governance.CostReservationService;
import com.blue.whale.agent.service.governance.UserInputRequestService;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;

@Service
@RequiredArgsConstructor
public class AgentRunWorkerService {

    private static final Set<String> IMAGE_ARGUMENTS =
            Set.of("prompt", "aspect_ratio", "reference_asset_ids", "size", "web_search");
    private static final Set<String> IMAGE_ASPECT_RATIOS =
            Set.of("1:1", "16:9", "9:16", "4:3", "3:4", "2:3", "3:2", "21:9");

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
    private final GenerationModelCapabilityMapper capabilityMapper;
    private final ObjectMapper objectMapper;

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

            List<RunWorkResponse.RunMessage> messages = messageMapper.selectList(
                            Wrappers.<ConversationMessage>lambdaQuery()
                                    .eq(ConversationMessage::getConversationId, run.getConversationId())
                                    .orderByAsc(ConversationMessage::getSequenceNo))
                    .stream()
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
                    acceptedResults);
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
        projectService.requireOwnedForUpdate(run.getProjectId(), run.getUserId());
        UserInputRequestProposal proposal = request.userInputRequest();
        if (request.error() != null) {
            // Worker 终态错误仍由 Java 拒绝：公开事实只承认 Java 接纳的状态转移。
            actionAuthorizationService.deny(
                    actionCommand(run, null, false), "WORKER_TERMINAL_NOT_ALLOWED");
        }
        if (proposal != null && !request.actions().isEmpty()) {
            // 提议与动作互斥：一次提交要么推进一个动作，要么提出一个输入请求。
            actionAuthorizationService.deny(
                    actionCommand(run, null, false), "PROPOSAL_ACTION_MUTEX");
        }
        if (proposal != null && run.getConfirmedInputRequestId() != null) {
            // 来源 AgentRun 已绑定待消费的确认请求，不接受新的输入请求提议。
            actionAuthorizationService.deny(
                    actionCommand(run, null, false), "ACTIVE_REQUEST_ALREADY_BOUND");
        }
        if (proposal == null && request.actions().isEmpty() && !supportsNoActionCompletion(run)) {
            actionAuthorizationService.deny(
                    actionCommand(run, null, false), "ACTION_MISSING");
        }
        RunCommitRequest.ProposedAction action = null;
        AuthorizationDecision authorization = null;
        if (proposal == null && !request.actions().isEmpty()) {
            try {
                action = validateAction(run, request.actions());
            } catch (GlobalException exception) {
                RunCommitRequest.ProposedAction proposed = request.actions().size() == 1
                        ? request.actions().get(0) : null;
                actionAuthorizationService.deny(actionCommand(run, proposed, false),
                        "ACTION_SCHEMA_OR_OWNERSHIP_REJECTED");
                throw exception;
            }
            boolean confirmed = run.getConfirmedInputRequestId() != null;
            if (confirmed) {
                userInputRequestService.consumeValidated(
                        run.getConfirmedInputRequestId(), run.getProjectId(), run.getUserId(), run.getId(),
                        action.actionId(), action.actionType(), action.arguments());
            }
            authorization = actionAuthorizationService.authorize(
                    actionCommand(run, action, confirmed));
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
        if (proposal != null) {
            // 创作澄清提议：原子保存 RuntimeCheckpoint（已在上文插入）与 UserInputRequest，
            // 令来源 AgentRun 进入等待输入状态并释放租约。无动作、无报价。
            inputRequest = userInputRequestService.createCreationClarification(
                    run.getProjectId(), run.getUserId(), conversation.getId(), runId,
                    proposal.question());
        } else if (action != null && authorization.outcome() == AuthorizationOutcome.INPUT_REQUIRED) {
            inputRequest = userInputRequestService.create(
                    run.getProjectId(), run.getUserId(), run.getConversationId(), runId,
                    action.actionId(), action.actionType(), action.arguments(), authorization.quote());
        } else if (action != null) {
            LinkedHashMap<String, Object> input = new LinkedHashMap<>(action.arguments());
            input.put("expected_output_count", 1);
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
            job = new GenerationJob()
                    .setProjectId(run.getProjectId())
                    .setUserId(run.getUserId())
                    .setAgentRunId(runId)
                    .setActionIdentity(action.actionId())
                    .setProjectActionIdentity(action.actionId())
                    .setType(GenerationJob.TYPE_IMAGE)
                    .setSource(GenerationJob.SOURCE_AGENT_RUN)
                    .setExpectedOutputCount(1)
                    .setInput(input)
                    .setStatus(GenerationJob.STATUS_QUEUED)
                    .setProgress(0)
                    .setFencingToken(0L)
                    .setStrategyVersion("image-sync-v1")
                    .setExecutionDeadlineAt(generationJobMapper.selectCurrentTime().plusMinutes(30))
                    .setNextActionAt(generationJobMapper.selectCurrentTime());
            generationJobMapper.insert(job);
            costAdmissionService.reserveAuthorized(
                    run.getUserId(), run.getProjectId(), job.getId(), action.actionId(),
                    action.actionType(), authorization.quote());
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
                .setStatus(inputRequest != null ? AgentRun.STATUS_AWAITING_INPUT
                        : job == null ? AgentRun.STATUS_COMPLETED : AgentRun.STATUS_AWAITING_JOB)
                .setStage(inputRequest != null
                        ? (proposal != null ? "awaiting_clarification" : "awaiting_confirmation")
                        : (job == null ? "completed" : "generating"))
                .setLeaseOwner(null)
                .setLeaseExpiresAt(null);
        agentRunMapper.updateById(run);
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

    private RunCommitRequest.ProposedAction validateAction(
            AgentRun run,
            List<RunCommitRequest.ProposedAction> actions) {
        if (actions.size() != 1) {
            throw new GlobalException(SystemCode.AGENT_ACTION_REJECTED_CODE,
                    "首版只接受单个图片生成动作");
        }
        RunCommitRequest.ProposedAction action = actions.get(0);
        Object aspectRatio = action.arguments().get("aspect_ratio");
        Object referenceAssetIds = action.arguments().get("reference_asset_ids");
        Object size = action.arguments().get("size");
        Object webSearch = action.arguments().get("web_search");
        if (!"generate_image".equals(action.actionType())
                || action.actionId().length() > 128
                || !IMAGE_ARGUMENTS.containsAll(action.arguments().keySet())
                || !(action.arguments().get("prompt") instanceof String prompt)
                || prompt.isBlank()
                || (aspectRatio != null
                        && (!(aspectRatio instanceof String ratio) || !IMAGE_ASPECT_RATIOS.contains(ratio)))
                || (referenceAssetIds != null
                        && !validReferenceAssetIds(run, referenceAssetIds))
                || (size != null && !(size instanceof String))
                || (webSearch != null && !(webSearch instanceof Boolean))
                || generationJobMapper.selectCount(Wrappers.<GenerationJob>lambdaQuery()
                        .eq(GenerationJob::getProjectId, run.getProjectId())
                        .eq(GenerationJob::getProjectActionIdentity, action.actionId())) > 0) {
            throw new GlobalException(SystemCode.AGENT_ACTION_REJECTED_CODE,
                    SystemCode.AGENT_ACTION_REJECTED.getMsg());
        }
        return action;
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
        if (!(value instanceof List<?> assetIds) || assetIds.isEmpty() || assetIds.size() > 4) {
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
            boolean confirmed) {
        return new ActionAuthorizationCommand(
                run.getUserId(), run.getProjectId(), "AgentRun", String.valueOf(run.getId()),
                "agent-run:" + run.getId(),
                action == null ? "commit-with-invalid-actions" : action.actionId(),
                action == null ? "unknown" : action.actionType(),
                action == null || action.arguments() == null ? Map.of() : action.arguments(),
                false, confirmed);
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
        if (commit == null || commit.getGenerationJobId() == null) {
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

    private boolean supportsNoActionCompletion(AgentRun run) {
        if (!"pydantic-ai".equals(run.getEngine())
                || !"2.9.0".equals(run.getEngineVersion())
                || !Integer.valueOf(1).equals(run.getAdapterSchemaVersion())
                || run.getCurrentCheckpointId() == null) {
            return false;
        }
        RuntimeCheckpoint checkpoint = checkpointMapper.selectById(run.getCurrentCheckpointId());
        return checkpointMatches(run, checkpoint)
                && acceptedResults(run, checkpoint).size() == 1;
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
