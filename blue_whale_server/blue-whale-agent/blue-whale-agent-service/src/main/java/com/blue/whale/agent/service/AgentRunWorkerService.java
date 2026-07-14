package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.AgentRunMapper;
import com.blue.whale.agent.mapper.ConversationMapper;
import com.blue.whale.agent.mapper.ConversationMessageMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.RunCommitRecordMapper;
import com.blue.whale.agent.mapper.RuntimeCheckpointMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.dto.RunCommitRequest;
import com.blue.whale.agent.model.dto.RunCommitResponse;
import com.blue.whale.agent.model.dto.RunWorkResponse;
import com.blue.whale.agent.model.entity.AgentRun;
import com.blue.whale.agent.model.entity.Conversation;
import com.blue.whale.agent.model.entity.ConversationMessage;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.RunCommitRecord;
import com.blue.whale.agent.model.entity.RuntimeCheckpoint;
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

    private static final Set<String> IMAGE_ARGUMENTS = Set.of("prompt", "aspect_ratio");
    private static final Set<String> IMAGE_ASPECT_RATIOS =
            Set.of("1:1", "16:9", "9:16", "4:3", "3:4", "2:3", "3:2", "21:9");

    private final AgentRunMapper agentRunMapper;
    private final ConversationMapper conversationMapper;
    private final ConversationMessageMapper messageMapper;
    private final RuntimeCheckpointMapper checkpointMapper;
    private final RunCommitRecordMapper runCommitMapper;
    private final GenerationJobMapper generationJobMapper;
    private final ProjectService projectService;
    private final ProjectEventService projectEventService;
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
            RuntimeCheckpoint checkpoint = run.getCurrentCheckpointId() == null
                    ? null : checkpointMapper.selectById(run.getCurrentCheckpointId());
            if (!checkpointMatches(run, checkpoint)) {
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
            return new RunWorkResponse(
                    run.getId(), run.getProjectId(), run.getConversationId(), run.getUserId(),
                    run.getVersion(), run.getFencingToken(), run.getEngine(), run.getEngineVersion(),
                    run.getAdapterSchemaVersion(), messages,
                    checkpoint == null ? null
                            : new RunWorkResponse.Checkpoint(checkpoint.getId(), checkpoint.getOpaquePayload()));
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
        projectService.requireOwned(run.getProjectId(), run.getUserId());
        if (request.userInputRequest() != null || request.error() != null) {
            throw new GlobalException(SystemCode.AGENT_ACTION_REJECTED_CODE,
                    "首版不接受用户补充输入或错误终态提交");
        }
        RunCommitRequest.ProposedAction action = validateAction(request.actions());

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
        long messageCount = messageMapper.selectCount(Wrappers.<ConversationMessage>lambdaQuery()
                .eq(ConversationMessage::getConversationId, conversation.getId()));
        ConversationMessage message = new ConversationMessage()
                .setConversationId(conversation.getId())
                .setProjectId(run.getProjectId())
                .setAgentRunId(runId)
                .setRole(ConversationMessage.ROLE_ASSISTANT)
                .setContent(request.visibleText())
                .setSequenceNo(Math.toIntExact(messageCount + 1));
        messageMapper.insert(message);

        GenerationJob job = new GenerationJob()
                .setProjectId(run.getProjectId())
                .setUserId(run.getUserId())
                .setAgentRunId(runId)
                .setActionIdentity(action.actionId())
                .setType(GenerationJob.TYPE_IMAGE)
                .setSource(GenerationJob.SOURCE_AGENT_RUN)
                .setInput(new LinkedHashMap<>(action.arguments()))
                .setStatus(GenerationJob.STATUS_QUEUED)
                .setProgress(0);
        generationJobMapper.insert(job);

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

        Map<String, Object> jobPayload = new LinkedHashMap<>();
        jobPayload.put("job_id", job.getId());
        jobPayload.put("agent_run_id", runId);
        jobPayload.put("action_identity", job.getActionIdentity());
        jobPayload.put("type", job.getType());
        jobPayload.put("source", job.getSource());
        jobPayload.put("status", job.getStatus());
        jobPayload.put("progress", job.getProgress());
        jobPayload.put("input", job.getInput());
        projectEventService.appendEvent(run.getProjectId(), EventType.GENERATION_JOB_CREATED,
                AggregateType.GENERATION_JOB, String.valueOf(job.getId()), job.getVersion(),
                jobPayload, request.commitId(), null);

        run.setCurrentCheckpointId(checkpoint.getId())
                .setStatus(AgentRun.STATUS_AWAITING_JOB)
                .setStage("generating")
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
                .setGenerationJobId(job.getId())
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

    private RunCommitRequest.ProposedAction validateAction(List<RunCommitRequest.ProposedAction> actions) {
        if (actions.size() != 1) {
            throw new GlobalException(SystemCode.AGENT_ACTION_REJECTED_CODE,
                    "首版只接受单个图片生成动作");
        }
        RunCommitRequest.ProposedAction action = actions.get(0);
        Object aspectRatio = action.arguments().get("aspect_ratio");
        if (!"generate_image".equals(action.actionType())
                || action.actionId().length() > 128
                || !IMAGE_ARGUMENTS.containsAll(action.arguments().keySet())
                || !(action.arguments().get("prompt") instanceof String prompt)
                || prompt.isBlank()
                || (aspectRatio != null
                        && (!(aspectRatio instanceof String ratio) || !IMAGE_ASPECT_RATIOS.contains(ratio)))) {
            throw new GlobalException(SystemCode.AGENT_ACTION_REJECTED_CODE,
                    SystemCode.AGENT_ACTION_REJECTED.getMsg());
        }
        return action;
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
        payload.put("current_checkpoint_id", run.getCurrentCheckpointId());
        return payload;
    }

    private RunCommitResponse response(RunCommitRecord record) {
        return new RunCommitResponse(
                record.getCheckpointId(), record.getGenerationJobId(), record.getCommittedCursor());
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
