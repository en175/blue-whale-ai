package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.AgentRunMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.GenerationJobOutputMapper;
import com.blue.whale.agent.mapper.GenerationResultConflictMapper;
import com.blue.whale.agent.mapper.GenerationProviderTaskMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.dto.GenerationAcceptanceResult;
import com.blue.whale.agent.model.dto.GenerationCancellationCommand;
import com.blue.whale.agent.model.dto.GenerationFailureCommand;
import com.blue.whale.agent.model.dto.GenerationResultCommand;
import com.blue.whale.agent.model.dto.VideoGenerationResultCommand;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.AgentRun;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.GenerationJobOutput;
import com.blue.whale.agent.model.entity.GenerationResultConflict;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.agent.service.governance.CostReservationService;
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
    private final AssetObjectLifecycleService assetObjectLifecycleService;
    private final AgentRunMapper agentRunMapper;
    private final ProjectEventService projectEventService;
    private final CostReservationService costReservationService;
    private final GenerationProviderTaskMapper providerTaskMapper;

    @Transactional
    public GenerationAcceptanceResult acceptSuccess(GenerationResultCommand command) {
        validateCommand(command);
        GenerationJob job = generationJobMapper.selectForUpdate(command.jobId());
        if (job == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        GenerationJobOutput output = outputMapper.selectForUpdate(command.jobId(), command.slotIndex());
        if (output == null) {
            throw conflict();
        }
        if (GenerationJobOutput.STATUS_SUCCEEDED.equals(output.getStatus())) {
            if (Objects.equals(output.getContentSha256(), command.contentSha256())) {
                return new GenerationAcceptanceResult(
                        GenerationAcceptanceResult.Status.IDEMPOTENT, output.getAssetId());
            }
            recordConflict(output, command);
            return new GenerationAcceptanceResult(
                    GenerationAcceptanceResult.Status.CONFLICT, output.getAssetId());
        }
        if (GenerationJobOutput.STATUS_FAILED.equals(output.getStatus())
                || GenerationJobOutput.STATUS_CANCELLED.equals(output.getStatus())
                || isTerminal(job)) {
            return new GenerationAcceptanceResult(GenerationAcceptanceResult.Status.CONFLICT, output.getAssetId());
        }

        requireCurrentFence(job, command.fencingToken());
        requireExecutionOwner(job, command, generationJobMapper.selectCurrentTime());
        assetObjectLifecycleService.protectReference(
                command.storageKey(), command.contentSha256(), Asset.SOURCE_GENERATED);
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

        output.setAssetId(asset.getId())
                .setDeliveryId(command.deliveryId())
                .setContentSha256(command.contentSha256())
                .setStatus(GenerationJobOutput.STATUS_SUCCEEDED)
                .setError(null);
        if (outputMapper.updateById(output) != 1) {
            throw conflict();
        }

        aggregate(job, null);
        updateAcceptedJob(job);
        GenerationJob accepted = generationJobMapper.selectById(job.getId());

        if (isTerminal(accepted)) {
            costReservationService.settleReserved(job.getId(), "PROVIDER_COST_PROVEN");
        }

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
        GenerationJobOutput output = outputMapper.selectForUpdate(command.jobId(), command.slotIndex());
        if (output == null) {
            throw conflict();
        }
        Map<String, Object> error = Map.of("code", command.errorCode(), "message", command.errorMessage());
        if (GenerationJobOutput.STATUS_FAILED.equals(output.getStatus())) {
            return new GenerationAcceptanceResult(
                    GenerationAcceptanceResult.Status.IDEMPOTENT, output.getAssetId());
        }
        if (GenerationJobOutput.STATUS_SUCCEEDED.equals(output.getStatus())
                || GenerationJobOutput.STATUS_CANCELLED.equals(output.getStatus())
                || isTerminal(job)) {
            return new GenerationAcceptanceResult(GenerationAcceptanceResult.Status.CONFLICT, output.getAssetId());
        }
        requireExecutionOwner(job, command.expectedJobVersion(), command.fencingToken(),
                command.leaseOwner(), generationJobMapper.selectCurrentTime());
        output.setStatus(GenerationJobOutput.STATUS_FAILED).setError(error);
        if (outputMapper.updateById(output) != 1) {
            throw conflict();
        }
        aggregate(job, error);
        updateAcceptedJob(job);
        GenerationJob failed = generationJobMapper.selectById(job.getId());
        if (isTerminal(failed)) {
            if (isOutcomeUnknown(command.errorCode())) {
                costReservationService.markPendingReconciliation(
                        job.getId(), "PROVIDER_RESULT_UNKNOWN");
            } else if ("provider_not_configured".equals(command.errorCode())) {
                costReservationService.release(job.getId(), "PROVIDER_NOT_CALLED");
            } else {
                costReservationService.settleReserved(job.getId(), "PROVIDER_COST_PROVEN");
            }
        }
        appendOutputUpdated(failed, output);
        appendJobStatusChanged(failed);
        resumePydanticRun(failed);
        return new GenerationAcceptanceResult(GenerationAcceptanceResult.Status.FAILED, null);
    }

    @Transactional
    public GenerationAcceptanceResult acceptCancellation(GenerationCancellationCommand command) {
        validateCancellationCommand(command);
        GenerationJob job = generationJobMapper.selectForUpdate(command.jobId());
        if (job == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        GenerationJobOutput output = outputMapper.selectForUpdate(command.jobId(), command.slotIndex());
        if (output == null) {
            throw conflict();
        }
        if (GenerationJobOutput.STATUS_CANCELLED.equals(output.getStatus())) {
            return new GenerationAcceptanceResult(
                    GenerationAcceptanceResult.Status.IDEMPOTENT, output.getAssetId());
        }
        if (GenerationJobOutput.STATUS_SUCCEEDED.equals(output.getStatus())
                || GenerationJobOutput.STATUS_FAILED.equals(output.getStatus())
                || isTerminal(job)) {
            return new GenerationAcceptanceResult(
                    GenerationAcceptanceResult.Status.CONFLICT, output.getAssetId());
        }
        requireCancellationOwner(job, command, generationJobMapper.selectCurrentTime());
        output.setStatus(GenerationJobOutput.STATUS_CANCELLED).setError(null);
        if (outputMapper.updateById(output) != 1) {
            throw conflict();
        }
        aggregate(job, null);
        updateAcceptedJob(job);
        GenerationJob cancelled = generationJobMapper.selectById(job.getId());
        if (isTerminal(cancelled)) {
            if (providerTaskMapper.countByJob(job.getId()) > 0) {
                costReservationService.settleReserved(job.getId(), "PROVIDER_CALL_STARTED");
            } else {
                costReservationService.release(job.getId(), "CANCELLED_BEFORE_PROVIDER");
            }
        }
        appendOutputUpdated(cancelled, output);
        appendJobStatusChanged(cancelled);
        resumePydanticRun(cancelled);
        return new GenerationAcceptanceResult(GenerationAcceptanceResult.Status.CANCELLED, null);
    }

    private boolean isOutcomeUnknown(String errorCode) {
        return "submission_unknown".equals(errorCode)
                || "outcome_unknown".equals(errorCode)
                || "timed_out".equals(errorCode);
    }

    @Transactional
    public GenerationAcceptanceResult acceptVideoSuccess(VideoGenerationResultCommand command) {
        validateVideoCommand(command);
        GenerationJob job = generationJobMapper.selectForUpdate(command.jobId());
        if (job == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        GenerationJobOutput output = outputMapper.selectForUpdate(command.jobId(), command.slotIndex());
        if (output == null) {
            throw conflict();
        }
        if (GenerationJobOutput.STATUS_SUCCEEDED.equals(output.getStatus())) {
            if (Objects.equals(output.getContentSha256(), command.contentSha256())) {
                return new GenerationAcceptanceResult(
                        GenerationAcceptanceResult.Status.IDEMPOTENT, output.getAssetId());
            }
            GenerationResultCommand conflictCommand = new GenerationResultCommand(
                    command.jobId(), command.slotIndex(), command.expectedJobVersion(),
                    command.fencingToken(), command.leaseOwner(), command.deliveryId(),
                    command.storageKey(), command.contentSha256(), command.mimeType(),
                    command.sizeBytes());
            recordConflict(output, conflictCommand);
            return new GenerationAcceptanceResult(
                GenerationAcceptanceResult.Status.CONFLICT, output.getAssetId());
        }
        if (GenerationJobOutput.STATUS_FAILED.equals(output.getStatus())
                || GenerationJobOutput.STATUS_CANCELLED.equals(output.getStatus())
                || isTerminal(job)) {
            return new GenerationAcceptanceResult(GenerationAcceptanceResult.Status.CONFLICT, output.getAssetId());
        }
        requireCurrentVideoFence(job, command.fencingToken());
        requireVideoExecutionOwner(job, command, generationJobMapper.selectCurrentTime());
        assetObjectLifecycleService.protectReference(
                command.storageKey(), command.contentSha256(), Asset.SOURCE_GENERATED);

        Asset asset = new Asset()
                .setProjectId(job.getProjectId())
                .setUserId(job.getUserId())
                .setGenerationJobId(job.getId())
                .setType(Asset.TYPE_VIDEO)
                .setStorageKey(command.storageKey())
                .setContentSha256(command.contentSha256())
                .setMime(command.mimeType())
                .setSize(command.sizeBytes())
                .setDuration(command.durationSeconds())
                .setSource(Asset.SOURCE_GENERATED)
                .setStatus(Asset.STATUS_NORMAL);
        assetMapper.insert(asset);

        output.setAssetId(asset.getId())
                .setDeliveryId(command.deliveryId())
                .setContentSha256(command.contentSha256())
                .setStatus(GenerationJobOutput.STATUS_SUCCEEDED)
                .setError(null);
        if (outputMapper.updateById(output) != 1) {
            throw conflict();
        }

        aggregate(job, null);
        updateAcceptedJob(job);
        GenerationJob accepted = generationJobMapper.selectById(job.getId());
        if (isTerminal(accepted)) {
            costReservationService.settleReserved(job.getId(), "PROVIDER_COST_PROVEN");
        }
        appendAssetCreated(asset, output);
        appendOutputAttached(output);
        appendJobStatusChanged(accepted);
        return new GenerationAcceptanceResult(GenerationAcceptanceResult.Status.ACCEPTED, asset.getId());
    }

    // ===== 组图模式（IK24Q9 方案 K）：单槽接纳不动 job 的 lease/version，
    //       claim0 的 fence/lease/version 全程保持，多槽独立事务均通过校验；
    //       最后 finalizeSequentialJob 一次 aggregate 算终态、清 lease、settle。 =====

    @Transactional
    public GenerationAcceptanceResult acceptSequentialSlot(GenerationResultCommand command) {
        validateCommand(command);
        GenerationJob job = generationJobMapper.selectForUpdate(command.jobId());
        if (job == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        GenerationJobOutput output = outputMapper.selectForUpdate(command.jobId(), command.slotIndex());
        if (output == null) {
            throw conflict();
        }
        if (GenerationJobOutput.STATUS_SUCCEEDED.equals(output.getStatus())) {
            if (Objects.equals(output.getContentSha256(), command.contentSha256())) {
                return new GenerationAcceptanceResult(
                        GenerationAcceptanceResult.Status.IDEMPOTENT, output.getAssetId());
            }
            recordConflict(output, command);
            return new GenerationAcceptanceResult(
                    GenerationAcceptanceResult.Status.CONFLICT, output.getAssetId());
        }
        if (GenerationJobOutput.STATUS_FAILED.equals(output.getStatus())
                || GenerationJobOutput.STATUS_CANCELLED.equals(output.getStatus())
                || isTerminal(job)) {
            return new GenerationAcceptanceResult(
                    GenerationAcceptanceResult.Status.CONFLICT, output.getAssetId());
        }
        requireCurrentFence(job, command.fencingToken());
        requireExecutionOwner(job, command, generationJobMapper.selectCurrentTime());
        assetObjectLifecycleService.protectReference(
                command.storageKey(), command.contentSha256(), Asset.SOURCE_GENERATED);
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
        output.setAssetId(asset.getId())
                .setDeliveryId(command.deliveryId())
                .setContentSha256(command.contentSha256())
                .setStatus(GenerationJobOutput.STATUS_SUCCEEDED)
                .setError(null);
        if (outputMapper.updateById(output) != 1) {
            throw conflict();
        }
        appendAssetCreated(asset, output);
        appendOutputAttached(output);
        return new GenerationAcceptanceResult(
                GenerationAcceptanceResult.Status.ACCEPTED, asset.getId());
    }

    @Transactional
    public GenerationAcceptanceResult acceptSequentialFailure(GenerationFailureCommand command) {
        validateFailureCommand(command);
        GenerationJob job = generationJobMapper.selectForUpdate(command.jobId());
        if (job == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        GenerationJobOutput output = outputMapper.selectForUpdate(command.jobId(), command.slotIndex());
        if (output == null) {
            throw conflict();
        }
        Map<String, Object> error = Map.of("code", command.errorCode(), "message", command.errorMessage());
        if (GenerationJobOutput.STATUS_FAILED.equals(output.getStatus())) {
            return new GenerationAcceptanceResult(
                    GenerationAcceptanceResult.Status.IDEMPOTENT, output.getAssetId());
        }
        if (GenerationJobOutput.STATUS_SUCCEEDED.equals(output.getStatus())
                || GenerationJobOutput.STATUS_CANCELLED.equals(output.getStatus())
                || isTerminal(job)) {
            return new GenerationAcceptanceResult(
                    GenerationAcceptanceResult.Status.CONFLICT, output.getAssetId());
        }
        requireExecutionOwner(job, command.expectedJobVersion(), command.fencingToken(),
                command.leaseOwner(), generationJobMapper.selectCurrentTime());
        output.setStatus(GenerationJobOutput.STATUS_FAILED).setError(error);
        if (outputMapper.updateById(output) != 1) {
            throw conflict();
        }
        appendOutputUpdated(job, output);
        return new GenerationAcceptanceResult(GenerationAcceptanceResult.Status.FAILED, null);
    }

    @Transactional
    public GenerationAcceptanceResult finalizeSequentialJob(Long jobId, Long fencingToken) {
        GenerationJob job = generationJobMapper.selectForUpdate(jobId);
        if (job == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        requireCurrentFence(job, fencingToken);
        aggregate(job, null);
        updateAcceptedJob(job);
        GenerationJob finalized = generationJobMapper.selectById(job.getId());
        if (isTerminal(finalized)) {
            costReservationService.settleReserved(job.getId(), "PROVIDER_COST_PROVEN");
        }
        appendJobStatusChanged(finalized);
        resumePydanticRun(finalized);
        boolean succeeded = GenerationJob.STATUS_SUCCEEDED.equals(finalized.getStatus());
        return new GenerationAcceptanceResult(
                succeeded ? GenerationAcceptanceResult.Status.ACCEPTED
                        : GenerationAcceptanceResult.Status.FAILED,
                null);
    }

    private void validateCommand(GenerationResultCommand command) {
        boolean valid = command != null
                && command.jobId() != null
                && command.slotIndex() >= 0
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
                && command.slotIndex() >= 0
                && command.expectedJobVersion() >= 0
                && command.fencingToken() > 0
                && command.leaseOwner() != null && !command.leaseOwner().isBlank()
                && command.errorCode() != null && !command.errorCode().isBlank()
                && command.errorMessage() != null && !command.errorMessage().isBlank();
        if (!valid) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "生成失败命令无效");
        }
    }

    private void validateCancellationCommand(GenerationCancellationCommand command) {
        boolean valid = command != null
                && command.jobId() != null
                && command.slotIndex() >= 0
                && command.expectedJobVersion() >= 0
                && command.fencingToken() > 0
                && command.leaseOwner() != null && !command.leaseOwner().isBlank();
        if (!valid) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "生成取消命令无效");
        }
    }

    private void validateVideoCommand(VideoGenerationResultCommand command) {
        boolean valid = command != null
                && command.jobId() != null
                && command.slotIndex() >= 0
                && command.expectedJobVersion() >= 0
                && command.fencingToken() > 0
                && command.leaseOwner() != null && !command.leaseOwner().isBlank()
                && command.deliveryId() != null && !command.deliveryId().isBlank()
                && command.deliveryId().length() <= 128
                && command.storageKey() != null && !command.storageKey().isBlank()
                && command.storageKey().length() <= 512
                && command.contentSha256() != null
                && command.contentSha256().matches("[0-9a-f]{64}")
                && "video/mp4".equals(command.mimeType())
                && command.sizeBytes() > 0
                && command.durationSeconds() >= 4
                && command.durationSeconds() <= 15;
        if (!valid) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "视频生成结果命令无效");
        }
    }

    private void requireVideoExecutionOwner(
            GenerationJob job,
            VideoGenerationResultCommand command,
            LocalDateTime databaseNow) {
        boolean activeStatus = GenerationJob.STATUS_PROCESSING.equals(job.getStatus())
                || GenerationJob.STATUS_CANCEL_REQUESTED.equals(job.getStatus());
        boolean matches = job.getProjectId() != null
                && GenerationJob.TYPE_VIDEO.equals(job.getType())
                && GenerationJob.SOURCE_BOTTOM_DOCK.equals(job.getSource())
                && activeStatus
                && resultVersionMatches(job, command.expectedJobVersion())
                && Objects.equals(job.getFencingToken(), command.fencingToken())
                && Objects.equals(job.getLeaseOwner(), command.leaseOwner())
                && job.getLeaseExpiresAt() != null
                && job.getLeaseExpiresAt().isAfter(databaseNow);
        if (!matches) {
            throw conflict();
        }
    }

    private void requireCurrentVideoFence(GenerationJob job, Long fencingToken) {
        boolean matches = job.getProjectId() != null
                && GenerationJob.TYPE_VIDEO.equals(job.getType())
                && GenerationJob.SOURCE_BOTTOM_DOCK.equals(job.getSource())
                && Objects.equals(job.getFencingToken(), fencingToken);
        if (!matches) {
            throw conflict();
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
        boolean matches = isWorkerImageJob(job)
                && Objects.equals(job.getFencingToken(), fencingToken);
        if (!matches) {
            throw conflict();
        }
    }

    private void requireCancellationOwner(
            GenerationJob job,
            GenerationCancellationCommand command,
            LocalDateTime databaseNow) {
        boolean currentVersion = Objects.equals(job.getVersion(), command.expectedJobVersion());
        boolean cancellationTransition = GenerationJob.STATUS_CANCEL_REQUESTED.equals(job.getStatus())
                && job.getVersion() != null
                && job.getVersion() == command.expectedJobVersion() + 1;
        boolean valid = job.getProjectId() != null
                && (GenerationJob.TYPE_IMAGE.equals(job.getType())
                || GenerationJob.TYPE_VIDEO.equals(job.getType()))
                && (GenerationJob.SOURCE_AGENT_RUN.equals(job.getSource())
                || GenerationJob.SOURCE_BOTTOM_DOCK.equals(job.getSource()))
                && GenerationJob.STATUS_CANCEL_REQUESTED.equals(job.getStatus())
                && (currentVersion || cancellationTransition)
                && Objects.equals(job.getFencingToken(), command.fencingToken())
                && Objects.equals(job.getLeaseOwner(), command.leaseOwner())
                && job.getLeaseExpiresAt() != null
                && job.getLeaseExpiresAt().isAfter(databaseNow);
        if (!valid) {
            throw conflict();
        }
    }

    private void requireExecutionOwner(
            GenerationJob job,
            Integer expectedJobVersion,
            Long fencingToken,
            String leaseOwner,
            LocalDateTime databaseNow) {
        boolean imageOwner = isWorkerImageJob(job)
                && (GenerationJob.STATUS_PROCESSING.equals(job.getStatus())
                || GenerationJob.STATUS_CANCEL_REQUESTED.equals(job.getStatus()));
        boolean videoOwner = job.getProjectId() != null
                && GenerationJob.TYPE_VIDEO.equals(job.getType())
                && GenerationJob.SOURCE_BOTTOM_DOCK.equals(job.getSource())
                && (GenerationJob.STATUS_PROCESSING.equals(job.getStatus())
                || GenerationJob.STATUS_CANCEL_REQUESTED.equals(job.getStatus()));
        boolean matches = (imageOwner || videoOwner)
                && resultVersionMatches(job, expectedJobVersion)
                && Objects.equals(job.getFencingToken(), fencingToken)
                && Objects.equals(job.getLeaseOwner(), leaseOwner)
                && job.getLeaseExpiresAt() != null
                && job.getLeaseExpiresAt().isAfter(databaseNow);
        if (!matches) {
            throw conflict();
        }
    }

    private boolean resultVersionMatches(GenerationJob job, Integer expectedJobVersion) {
        return Objects.equals(job.getVersion(), expectedJobVersion)
                || (GenerationJob.STATUS_CANCEL_REQUESTED.equals(job.getStatus())
                && job.getVersion() != null
                && expectedJobVersion != null
                && job.getVersion() == expectedJobVersion + 1);
    }

    private boolean isWorkerImageJob(GenerationJob job) {
        return job.getProjectId() != null
                && GenerationJob.TYPE_IMAGE.equals(job.getType())
                && (GenerationJob.SOURCE_AGENT_RUN.equals(job.getSource())
                || GenerationJob.SOURCE_BOTTOM_DOCK.equals(job.getSource()));
    }

    private void aggregate(GenerationJob job, Map<String, Object> currentFailure) {
        List<GenerationJobOutput> outputs = outputMapper.selectByJobForUpdate(job.getId());
        int expected = job.getExpectedOutputCount() == null ? 1 : job.getExpectedOutputCount();
        if (outputs.size() != expected || expected < 1) {
            throw conflict();
        }
        List<Long> assetIds = outputs.stream()
                .filter(output -> GenerationJobOutput.STATUS_SUCCEEDED.equals(output.getStatus()))
                .map(GenerationJobOutput::getAssetId)
                .filter(Objects::nonNull)
                .toList();
        long resolved = outputs.stream()
                .filter(output -> GenerationJobOutput.STATUS_SUCCEEDED.equals(output.getStatus())
                        || GenerationJobOutput.STATUS_FAILED.equals(output.getStatus())
                        || GenerationJobOutput.STATUS_CANCELLED.equals(output.getStatus()))
                .count();
        long cancelled = outputs.stream()
                .filter(output -> GenerationJobOutput.STATUS_CANCELLED.equals(output.getStatus()))
                .count();
        boolean hasFailure = outputs.stream()
                .anyMatch(output -> GenerationJobOutput.STATUS_FAILED.equals(output.getStatus()));

        if (resolved < expected) {
            job.setStatus(job.getCancelRequestedAt() == null
                            ? GenerationJob.STATUS_PROCESSING
                            : GenerationJob.STATUS_CANCEL_REQUESTED)
                    .setError(null);
        } else if (assetIds.size() == expected) {
            job.setStatus(GenerationJob.STATUS_SUCCEEDED).setError(null);
        } else if (!assetIds.isEmpty()) {
            job.setStatus(GenerationJob.STATUS_PARTIALLY_SUCCEEDED).setError(null);
        } else if (cancelled == expected) {
            job.setStatus(GenerationJob.STATUS_CANCELLED).setError(null);
        } else {
            Map<String, Object> firstError = outputs.stream()
                    .map(GenerationJobOutput::getError)
                    .filter(Objects::nonNull)
                    .findFirst()
                    .orElse(currentFailure == null
                            ? Map.of("code", "all_outputs_failed", "message", "所有输出均生成失败")
                            : currentFailure);
            job.setStatus(GenerationJob.STATUS_FAILED)
                    .setError(firstError);
        }
        LocalDateTime nextActionAt = GenerationJob.TYPE_VIDEO.equals(job.getType())
                && GenerationJob.STATUS_PARTIALLY_SUCCEEDED.equals(job.getStatus())
                && hasFailure
                ? generationJobMapper.selectCurrentTime() : null;
        job.setOutputAssetIds(assetIds)
                .setLeaseOwner(null)
                .setLeaseExpiresAt(null)
                .setNextActionAt(nextActionAt);
        if (GenerationJob.TYPE_IMAGE.equals(job.getType())) {
            job.setProgress((int) (resolved * 100 / expected));
        }
    }

    private void updateAcceptedJob(GenerationJob job) {
        if (generationJobMapper.updateById(job) != 1) {
            throw conflict();
        }
    }

    private boolean isTerminal(GenerationJob job) {
        return GenerationJob.STATUS_SUCCEEDED.equals(job.getStatus())
                || GenerationJob.STATUS_PARTIALLY_SUCCEEDED.equals(job.getStatus())
                || GenerationJob.STATUS_FAILED.equals(job.getStatus())
                || GenerationJob.STATUS_CANCELLED.equals(job.getStatus());
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
        payload.put("access_url", assetAccessUrl(asset));
        projectEventService.appendEvent(asset.getProjectId(), EventType.ASSET_CREATED,
                AggregateType.ASSET, String.valueOf(asset.getId()), asset.getVersion(),
                payload, null, null);
    }

    private void appendOutputAttached(GenerationJobOutput output) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("job_id", output.getGenerationJobId());
        payload.put("slot_index", output.getSlotIndex());
        payload.put("asset_id", output.getAssetId());
        payload.put("status", output.getStatus());
        projectEventService.appendEvent(projectId(output.getGenerationJobId()),
                EventType.GENERATION_JOB_OUTPUT_ATTACHED,
                AggregateType.GENERATION_JOB_OUTPUT,
                output.getGenerationJobId() + ":" + output.getSlotIndex(), output.getVersion(),
                payload, null, null);
    }

    private void appendOutputUpdated(GenerationJob job, GenerationJobOutput output) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("job_id", output.getGenerationJobId());
        payload.put("slot_index", output.getSlotIndex());
        payload.put("status", output.getStatus());
        payload.put("asset_id", output.getAssetId());
        payload.put("error", GenerationPublicError.project(
                output.getError(), job.getType(),
                costReservationService.budgetEffect(job.getId()).wireValue()));
        projectEventService.appendEvent(job.getProjectId(),
                EventType.GENERATION_JOB_OUTPUT_UPDATED,
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

    void resumePydanticRun(GenerationJob job) {
        if (!isTerminal(job)
                || !GenerationJob.SOURCE_AGENT_RUN.equals(job.getSource())
                || job.getAgentRunId() == null) {
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

    private String assetAccessUrl(Asset asset) {
        String base = "/api/projects/" + asset.getProjectId() + "/assets/" + asset.getId();
        return Asset.TYPE_VIDEO.equals(asset.getType()) ? base : base + "/content";
    }

    private GlobalException conflict() {
        return new GlobalException(SystemCode.AGENT_RUN_CONFLICT_CODE,
                "GenerationJob 执行权或版本无效");
    }

}
