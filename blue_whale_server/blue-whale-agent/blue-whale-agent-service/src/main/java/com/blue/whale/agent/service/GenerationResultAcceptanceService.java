package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.AgentRunMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.GenerationJobOutputMapper;
import com.blue.whale.agent.mapper.GenerationResultConflictMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.dto.GenerationAcceptanceResult;
import com.blue.whale.agent.model.dto.GenerationFailureCommand;
import com.blue.whale.agent.model.dto.GenerationResultCommand;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.AgentRun;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.GenerationJobOutput;
import com.blue.whale.agent.model.entity.GenerationResultConflict;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

@Service
@RequiredArgsConstructor
public class GenerationResultAcceptanceService {

    private final GenerationJobMapper generationJobMapper;
    private final GenerationJobOutputMapper outputMapper;
    private final GenerationResultConflictMapper conflictMapper;
    private final AssetMapper assetMapper;
    private final AgentRunMapper agentRunMapper;
    private final ProjectEventService projectEventService;

    @Transactional
    public GenerationAcceptanceResult acceptSuccess(GenerationResultCommand command) {
        validateCommand(command);
        GenerationJob job = generationJobMapper.selectForUpdate(command.jobId());
        if (job == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        requireCurrentFence(job, command.fencingToken());
        GenerationJobOutput existing = outputMapper.selectForUpdate(command.jobId(), command.slotIndex());
        if (existing != null) {
            if (Objects.equals(existing.getContentSha256(), command.contentSha256())) {
                return new GenerationAcceptanceResult(
                        GenerationAcceptanceResult.Status.IDEMPOTENT, existing.getAssetId());
            }
            recordConflict(existing, command);
            return new GenerationAcceptanceResult(
                    GenerationAcceptanceResult.Status.CONFLICT, existing.getAssetId());
        }

        requireExecutionOwner(job, command, generationJobMapper.selectCurrentTime());
        Asset asset = new Asset()
                .setProjectId(job.getProjectId())
                .setUserId(job.getUserId())
                .setGenerationJobId(job.getId())
                .setType(Asset.TYPE_IMAGE)
                .setStorageKey(command.storageKey())
                .setContentSha256(command.contentSha256())
                .setMime(command.mimeType())
                .setSize(command.sizeBytes())
                .setWidth(command.width())
                .setHeight(command.height())
                .setSource(Asset.SOURCE_GENERATED)
                .setStatus(Asset.STATUS_NORMAL);
        assetMapper.insert(asset);

        GenerationJobOutput output = new GenerationJobOutput()
                .setGenerationJobId(job.getId())
                .setSlotIndex(command.slotIndex())
                .setAssetId(asset.getId())
                .setDeliveryId(command.deliveryId())
                .setContentSha256(command.contentSha256());
        outputMapper.insert(output);

        job.setStatus(GenerationJob.STATUS_SUCCEEDED)
                .setProgress(100)
                .setOutputAssetIds(List.of(asset.getId()));
        if (generationJobMapper.updateById(job) != 1) {
            throw conflict();
        }
        clearLease(job.getId());
        GenerationJob accepted = generationJobMapper.selectById(job.getId());

        appendAssetCreated(asset, output);
        appendOutputAttached(output);
        appendJobStatusChanged(accepted);
        resumePydanticRun(accepted);
        return new GenerationAcceptanceResult(GenerationAcceptanceResult.Status.ACCEPTED, asset.getId());
    }

    @Transactional
    public GenerationAcceptanceResult acceptFailure(GenerationFailureCommand command) {
        validateFailureCommand(command);
        GenerationJob job = generationJobMapper.selectForUpdate(command.jobId());
        if (job == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        requireExecutionOwner(job, command.expectedJobVersion(), command.fencingToken(),
                command.leaseOwner(), generationJobMapper.selectCurrentTime());
        job.setStatus(GenerationJob.STATUS_FAILED)
                .setError(Map.of("code", command.errorCode(), "message", command.errorMessage()));
        if (generationJobMapper.updateById(job) != 1) {
            throw conflict();
        }
        clearLease(job.getId());
        GenerationJob failed = generationJobMapper.selectById(job.getId());
        appendJobStatusChanged(failed);
        resumePydanticRun(failed);
        return new GenerationAcceptanceResult(GenerationAcceptanceResult.Status.FAILED, null);
    }

    private void validateCommand(GenerationResultCommand command) {
        boolean valid = command != null
                && command.jobId() != null
                && command.slotIndex() == 0
                && command.expectedJobVersion() >= 0
                && command.fencingToken() > 0
                && command.leaseOwner() != null && !command.leaseOwner().isBlank()
                && command.deliveryId() != null && !command.deliveryId().isBlank()
                && command.deliveryId().length() <= 128
                && command.storageKey() != null && !command.storageKey().isBlank()
                && command.storageKey().length() <= 512
                && command.contentSha256() != null
                && command.contentSha256().matches("[0-9a-f]{64}")
                && command.mimeType() != null && command.mimeType().startsWith("image/")
                && command.sizeBytes() > 0
                && ((command.width() == null && command.height() == null)
                        || (command.width() != null && command.width() > 0
                        && command.height() != null && command.height() > 0));
        if (!valid) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "生成结果命令无效");
        }
    }

    private void validateFailureCommand(GenerationFailureCommand command) {
        boolean valid = command != null
                && command.jobId() != null
                && command.expectedJobVersion() >= 0
                && command.fencingToken() > 0
                && command.leaseOwner() != null && !command.leaseOwner().isBlank()
                && command.errorCode() != null && !command.errorCode().isBlank()
                && command.errorMessage() != null && !command.errorMessage().isBlank();
        if (!valid) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "生成失败命令无效");
        }
    }

    private void requireExecutionOwner(
            GenerationJob job,
            GenerationResultCommand command,
            LocalDateTime databaseNow) {
        requireExecutionOwner(job, command.expectedJobVersion(), command.fencingToken(),
                command.leaseOwner(), databaseNow);
    }

    private void requireCurrentFence(GenerationJob job, Long fencingToken) {
        boolean matches = job.getProjectId() != null
                && GenerationJob.SOURCE_AGENT_RUN.equals(job.getSource())
                && GenerationJob.TYPE_IMAGE.equals(job.getType())
                && Objects.equals(job.getFencingToken(), fencingToken);
        if (!matches) {
            throw conflict();
        }
    }

    private void requireExecutionOwner(
            GenerationJob job,
            Integer expectedJobVersion,
            Long fencingToken,
            String leaseOwner,
            LocalDateTime databaseNow) {
        boolean matches = job.getProjectId() != null
                && GenerationJob.SOURCE_AGENT_RUN.equals(job.getSource())
                && GenerationJob.TYPE_IMAGE.equals(job.getType())
                && GenerationJob.STATUS_PROCESSING.equals(job.getStatus())
                && Objects.equals(job.getVersion(), expectedJobVersion)
                && Objects.equals(job.getFencingToken(), fencingToken)
                && Objects.equals(job.getLeaseOwner(), leaseOwner)
                && job.getLeaseExpiresAt() != null
                && job.getLeaseExpiresAt().isAfter(databaseNow);
        if (!matches) {
            throw conflict();
        }
    }

    private void recordConflict(GenerationJobOutput existing, GenerationResultCommand command) {
        conflictMapper.insert(new GenerationResultConflict()
                .setGenerationJobId(command.jobId())
                .setSlotIndex(command.slotIndex())
                .setAttemptedDeliveryId(command.deliveryId())
                .setExpectedContentSha256(existing.getContentSha256())
                .setActualContentSha256(command.contentSha256())
                .setReason("slot_content_mismatch"));
    }

    private void appendAssetCreated(Asset asset, GenerationJobOutput output) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("asset_id", asset.getId());
        payload.put("generation_job_id", asset.getGenerationJobId());
        payload.put("slot_index", output.getSlotIndex());
        payload.put("type", asset.getType());
        payload.put("access_url", assetAccessUrl(asset.getProjectId(), asset.getId()));
        projectEventService.appendEvent(asset.getProjectId(), EventType.ASSET_CREATED,
                AggregateType.ASSET, String.valueOf(asset.getId()), asset.getVersion(),
                payload, null, null);
    }

    private void appendOutputAttached(GenerationJobOutput output) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("job_id", output.getGenerationJobId());
        payload.put("slot_index", output.getSlotIndex());
        payload.put("asset_id", output.getAssetId());
        projectEventService.appendEvent(projectId(output.getGenerationJobId()),
                EventType.GENERATION_JOB_OUTPUT_ATTACHED,
                AggregateType.GENERATION_JOB_OUTPUT,
                output.getGenerationJobId() + ":" + output.getSlotIndex(), output.getVersion(),
                payload, null, null);
    }

    private void appendJobStatusChanged(GenerationJob job) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("job_id", job.getId());
        payload.put("status", job.getStatus());
        payload.put("progress", job.getProgress());
        payload.put("output_asset_ids", job.getOutputAssetIds());
        projectEventService.appendEvent(job.getProjectId(), EventType.GENERATION_JOB_STATUS_CHANGED,
                AggregateType.GENERATION_JOB, String.valueOf(job.getId()), job.getVersion(),
                payload, null, null);
    }

    private void resumePydanticRun(GenerationJob job) {
        if (!GenerationJob.SOURCE_AGENT_RUN.equals(job.getSource()) || job.getAgentRunId() == null) {
            return;
        }
        AgentRun run = agentRunMapper.selectForUpdate(job.getAgentRunId());
        if (run == null
                || !AgentRun.STATUS_AWAITING_JOB.equals(run.getStatus())
                || !"pydantic-ai".equals(run.getEngine())
                || !"2.9.0".equals(run.getEngineVersion())
                || !Integer.valueOf(1).equals(run.getAdapterSchemaVersion())) {
            return;
        }
        run.setStatus(AgentRun.STATUS_QUEUED)
                .setStage("resuming")
                .setLeaseOwner(null)
                .setLeaseExpiresAt(null);
        agentRunMapper.updateById(run);
        AgentRun resumed = agentRunMapper.selectById(run.getId());
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("agent_run_id", resumed.getId());
        payload.put("conversation_id", resumed.getConversationId());
        payload.put("status", resumed.getStatus());
        payload.put("stage", resumed.getStage());
        payload.put("engine", resumed.getEngine());
        payload.put("engine_version", resumed.getEngineVersion());
        payload.put("adapter_schema_version", resumed.getAdapterSchemaVersion());
        payload.put("current_checkpoint_id", resumed.getCurrentCheckpointId());
        projectEventService.appendEvent(resumed.getProjectId(), EventType.AGENT_RUN_STATUS_CHANGED,
                AggregateType.AGENT_RUN, String.valueOf(resumed.getId()), resumed.getVersion(),
                payload, null, null);
    }

    private Long projectId(Long jobId) {
        GenerationJob job = generationJobMapper.selectById(jobId);
        if (job == null || job.getProjectId() == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        return job.getProjectId();
    }

    private String assetAccessUrl(Long projectId, Long assetId) {
        return "/api/projects/" + projectId + "/assets/" + assetId + "/content";
    }

    private GlobalException conflict() {
        return new GlobalException(SystemCode.AGENT_RUN_CONFLICT_CODE,
                "GenerationJob 执行权或版本无效");
    }

    private void clearLease(Long jobId) {
        generationJobMapper.update(null, Wrappers.<GenerationJob>lambdaUpdate()
                .eq(GenerationJob::getId, jobId)
                .set(GenerationJob::getLeaseOwner, null)
                .set(GenerationJob::getLeaseExpiresAt, null));
    }
}
