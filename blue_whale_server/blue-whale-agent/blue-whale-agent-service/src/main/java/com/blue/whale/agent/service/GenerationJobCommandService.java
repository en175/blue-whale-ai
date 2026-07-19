package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.common.crypto.Sha256;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.CommandIdempotencyMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.GenerationJobOutputMapper;
import com.blue.whale.agent.mapper.GenerationModelCapabilityMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.dto.CreateGenerationJobRequest;
import com.blue.whale.agent.model.dto.CreateGenerationJobResponse;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.CommandIdempotency;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.GenerationJobOutput;
import com.blue.whale.agent.model.entity.GenerationModelCapability;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.agent.service.governance.GenerationCostAdmissionService;
import com.blue.whale.agent.service.governance.AuthorizedGenerationAction;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.time.LocalDateTime;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class GenerationJobCommandService {

    private static final String OPERATION = "generation_job.create.bottom_dock";
    private static final String RETRY_OPERATION = "generation_job.retry_missing";

    private final ProjectService projectService;
    private final AssetMapper assetMapper;
    private final GenerationJobMapper generationJobMapper;
    private final GenerationJobOutputMapper generationJobOutputMapper;
    private final CommandIdempotencyMapper idempotencyMapper;
    private final ProjectEventService projectEventService;
    private final GenerationCostAdmissionService costAdmissionService;
    private final GenerationModelCapabilityMapper capabilityMapper;

    @Transactional
    public CreateGenerationJobResponse create(
            Long projectId,
            Long userId,
            String idempotencyKey,
            CreateGenerationJobRequest request,
            Long inputRequestId) {
        if (idempotencyKey == null || idempotencyKey.isBlank() || idempotencyKey.length() > 128) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "Idempotency-Key 无效");
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
        if (!GenerationJob.TYPE_IMAGE.equals(request.type())
                && !GenerationJob.TYPE_VIDEO.equals(request.type())) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "暂不支持该生成类型");
        }
        if (!request.parameters().isValidFor(request.type())) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "生成参数不在服务端能力范围内");
        }
        requireOwnedInputAssets(projectId, userId, request.inputAssetIds());

        Map<String, Object> input = new LinkedHashMap<>();
        input.put("prompt", request.parameters().prompt());
        input.put("aspect_ratio", request.parameters().aspectRatio());
        if (GenerationJob.TYPE_IMAGE.equals(request.type())) {
            // 按 capability 白名单校验 model_id 与 size：fail early 在 cost 授权与 Job 落库之前，
            // 非法模型/尺寸直接拒绝，不产生付费调用（IK21O5）
            GenerationModelCapability capability = requireImageCapability(request.parameters().modelId());
            input.put("model_id", capability.getModelId());
            input.put("size", resolveSupportedSize(request.parameters().size(), capability));
            input.put("web_search", Boolean.TRUE.equals(request.parameters().webSearch()));
        }
        if (GenerationJob.TYPE_VIDEO.equals(request.type())) {
            input.put("resolution", request.parameters().resolution());
            input.put("duration", request.parameters().duration());
        }
        if (!request.inputAssetIds().isEmpty()) {
            input.put("reference_asset_ids", request.inputAssetIds());
        }
        input.put("expected_output_count", request.expectedOutputCount());
        String actionIdentity = "bottom-dock:" + Sha256.hex(projectId + "\u0000" + OPERATION
                + "\u0000" + idempotencyKey);
        String actionType = GenerationJob.TYPE_VIDEO.equals(request.type())
                ? "generate_video" : "generate_image";
        AuthorizedGenerationAction authorization = costAdmissionService.authorizeRequest(
                userId, projectId, "GenerationRequest", actionIdentity, actionIdentity,
                actionType, input, false, inputRequestId);
        GenerationJob job = new GenerationJob()
                .setProjectId(projectId)
                .setUserId(userId)
                .setType(request.type())
                .setSource(GenerationJob.SOURCE_BOTTOM_DOCK)
                .setActionIdentity(authorization.actionIdentity())
                .setProjectActionIdentity(authorization.actionIdentity())
                .setExpectedOutputCount(request.expectedOutputCount())
                .setInput(input)
                .setStatus(GenerationJob.STATUS_QUEUED)
                .setProgress(GenerationJob.TYPE_VIDEO.equals(request.type()) ? null : 0)
                .setFencingToken(0L);
        LocalDateTime databaseNow = generationJobMapper.selectCurrentTime();
        if (GenerationJob.TYPE_VIDEO.equals(request.type())) {
            job.setStrategyVersion("seedance-2.0-v1")
                    .setExecutionDeadlineAt(databaseNow.plusMinutes(30))
                    .setEvidenceReconcileUntil(databaseNow.plusHours(24))
                    .setNextActionAt(databaseNow);
        } else {
            job.setStrategyVersion("image-sync-v1")
                    .setExecutionDeadlineAt(databaseNow.plusMinutes(30))
                    .setNextActionAt(databaseNow);
        }
        generationJobMapper.insert(job);
        costAdmissionService.reserveAuthorized(
                userId, projectId, job.getId(), job.getActionIdentity(),
                actionType, authorization.quote());
        for (int slotIndex = 0; slotIndex < request.expectedOutputCount(); slotIndex++) {
            generationJobOutputMapper.insert(new GenerationJobOutput()
                    .setGenerationJobId(job.getId())
                    .setSlotIndex(slotIndex)
                    .setStatus(GenerationJobOutput.STATUS_PENDING));
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("job_id", job.getId());
        payload.put("action_identity", job.getActionIdentity());
        payload.put("type", job.getType());
        payload.put("source", job.getSource());
        payload.put("status", job.getStatus());
        payload.put("progress", job.getProgress());
        payload.put("input", job.getInput());
        payload.put("expected_output_count", job.getExpectedOutputCount());
        payload.put("retry_of_job_id", job.getRetryOfJobId());
        payload.put("outputs", java.util.stream.IntStream.range(0, job.getExpectedOutputCount())
                .mapToObj(slotIndex -> Map.of(
                        "slot_index", (Object) slotIndex,
                        "status", GenerationJobOutput.STATUS_PENDING))
                .toList());
        projectEventService.appendEvent(projectId, EventType.GENERATION_JOB_CREATED,
                AggregateType.GENERATION_JOB, String.valueOf(job.getId()), job.getVersion(),
                payload, idempotencyKey, null);

        long cursor = projectEventService.highWatermark(projectId);
        CommandIdempotency accepted = new CommandIdempotency()
                .setProjectId(projectId)
                .setOperation(OPERATION)
                .setIdempotencyKey(idempotencyKey)
                .setRequestHash(requestHash)
                .setGenerationJobId(job.getId())
                .setAcceptedCursor(cursor);
        idempotencyMapper.insert(accepted);
        return response(accepted);
    }

    @Transactional
    public CreateGenerationJobResponse retryMissingOutputs(
            Long projectId,
            Long originalJobId,
            Long userId,
            String idempotencyKey,
            Long inputRequestId) {
        requireIdempotencyKey(idempotencyKey);
        projectService.requireOwnedForUpdate(projectId, userId);
        GenerationJob original = generationJobMapper.selectForUpdate(originalJobId);
        if (original == null
                || !Objects.equals(original.getProjectId(), projectId)
                || !Objects.equals(original.getUserId(), userId)) {
            throw resourceNotFound();
        }
        boolean retryableStatus = GenerationJob.STATUS_PARTIALLY_SUCCEEDED.equals(original.getStatus())
                || GenerationJob.STATUS_FAILED.equals(original.getStatus());
        boolean executableSource = GenerationJob.SOURCE_BOTTOM_DOCK.equals(original.getSource())
                || GenerationJob.SOURCE_AGENT_RUN.equals(original.getSource());
        if (!retryableStatus || !executableSource) {
            throw new GlobalException(SystemCode.AGENT_RUN_CONFLICT_CODE, "生成任务当前不可重试");
        }
        List<GenerationJobOutput> failedOutputs = generationJobOutputMapper
                .selectByJobForUpdate(originalJobId).stream()
                .filter(output -> GenerationJobOutput.STATUS_FAILED.equals(output.getStatus()))
                .toList();
        if (failedOutputs.isEmpty()) {
            throw new GlobalException(SystemCode.AGENT_RUN_CONFLICT_CODE, "生成任务没有缺失输出");
        }

        String requestHash = Sha256.hex(originalJobId + "\u0000" + failedOutputs.stream()
                .map(output -> String.valueOf(output.getSlotIndex()))
                .collect(Collectors.joining(",")));
        CommandIdempotency existing = idempotencyMapper.selectOne(
                Wrappers.<CommandIdempotency>lambdaQuery()
                        .eq(CommandIdempotency::getProjectId, projectId)
                        .eq(CommandIdempotency::getOperation, RETRY_OPERATION)
                        .eq(CommandIdempotency::getIdempotencyKey, idempotencyKey));
        if (existing != null) {
            if (!requestHash.equals(existing.getRequestHash())) {
                throw new GlobalException(SystemCode.IDEMPOTENCY_KEY_REUSED_CODE,
                        SystemCode.IDEMPOTENCY_KEY_REUSED.getMsg());
            }
            return response(existing);
        }

        Map<String, Object> input = original.getInput() == null
                ? new LinkedHashMap<>() : new LinkedHashMap<>(original.getInput());
        input.put("expected_output_count", failedOutputs.size());
        input.put("retry_slot_indexes", failedOutputs.stream()
                .map(GenerationJobOutput::getSlotIndex).toList());
        String actionIdentity = "retry:" + originalJobId + ":" + Sha256.hex(idempotencyKey);
        String actionType = GenerationJob.TYPE_VIDEO.equals(original.getType())
                ? "generate_video" : "generate_image";
        AuthorizedGenerationAction authorization = costAdmissionService.authorizeRequest(
                userId, projectId, "GenerationRetryRequest", actionIdentity, actionIdentity,
                actionType, input, false, inputRequestId);
        GenerationJob retry = new GenerationJob()
                .setProjectId(projectId)
                .setUserId(userId)
                .setAgentRunId(original.getAgentRunId())
                .setActionIdentity(authorization.actionIdentity())
                .setProjectActionIdentity(authorization.actionIdentity())
                .setExpectedOutputCount(failedOutputs.size())
                .setRetryOfJobId(originalJobId)
                .setType(original.getType())
                .setSource(original.getSource())
                .setInput(input)
                .setStatus(GenerationJob.STATUS_QUEUED)
                .setProgress(GenerationJob.TYPE_VIDEO.equals(original.getType()) ? null : 0)
                .setFencingToken(0L);
        LocalDateTime databaseNow = generationJobMapper.selectCurrentTime();
        if (GenerationJob.TYPE_VIDEO.equals(original.getType())) {
            retry.setStrategyVersion("seedance-2.0-v1")
                    .setExecutionDeadlineAt(databaseNow.plusMinutes(30))
                    .setEvidenceReconcileUntil(databaseNow.plusHours(24))
                    .setNextActionAt(databaseNow);
        } else {
            retry.setStrategyVersion("image-sync-v1")
                    .setExecutionDeadlineAt(databaseNow.plusMinutes(30))
                    .setNextActionAt(databaseNow);
        }
        generationJobMapper.insert(retry);
        costAdmissionService.reserveAuthorized(
                userId, projectId, retry.getId(), retry.getActionIdentity(),
                actionType, authorization.quote());
        for (GenerationJobOutput failedOutput : failedOutputs) {
            generationJobOutputMapper.insert(new GenerationJobOutput()
                    .setGenerationJobId(retry.getId())
                    .setSlotIndex(failedOutput.getSlotIndex())
                    .setStatus(GenerationJobOutput.STATUS_PENDING));
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("job_id", retry.getId());
        payload.put("action_identity", retry.getActionIdentity());
        payload.put("agent_run_id", retry.getAgentRunId());
        payload.put("type", retry.getType());
        payload.put("source", retry.getSource());
        payload.put("status", retry.getStatus());
        payload.put("progress", retry.getProgress());
        payload.put("input", retry.getInput());
        payload.put("expected_output_count", retry.getExpectedOutputCount());
        payload.put("retry_of_job_id", retry.getRetryOfJobId());
        payload.put("outputs", failedOutputs.stream()
                .map(output -> Map.of(
                        "slot_index", (Object) output.getSlotIndex(),
                        "status", GenerationJobOutput.STATUS_PENDING))
                .toList());
        projectEventService.appendEvent(projectId, EventType.GENERATION_JOB_CREATED,
                AggregateType.GENERATION_JOB, String.valueOf(retry.getId()), retry.getVersion(),
                payload, idempotencyKey, null);

        long cursor = projectEventService.highWatermark(projectId);
        CommandIdempotency accepted = new CommandIdempotency()
                .setProjectId(projectId)
                .setOperation(RETRY_OPERATION)
                .setIdempotencyKey(idempotencyKey)
                .setRequestHash(requestHash)
                .setGenerationJobId(retry.getId())
                .setAcceptedCursor(cursor);
        idempotencyMapper.insert(accepted);
        return response(accepted);
    }

    private CreateGenerationJobResponse response(CommandIdempotency record) {
        return new CreateGenerationJobResponse(record.getGenerationJobId(), record.getAcceptedCursor());
    }

    private void requireIdempotencyKey(String idempotencyKey) {
        if (idempotencyKey == null || idempotencyKey.isBlank() || idempotencyKey.length() > 128) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "Idempotency-Key 无效");
        }
    }

    private void requireOwnedInputAssets(Long projectId, Long userId, List<Long> inputAssetIds) {
        if (inputAssetIds.isEmpty()) {
            return;
        }
        if (new HashSet<>(inputAssetIds).size() != inputAssetIds.size()) {
            throw resourceNotFound();
        }
        List<Asset> assets = assetMapper.selectByIds(inputAssetIds);
        boolean allOwnedImages = assets.size() == inputAssetIds.size()
                && assets.stream().allMatch(asset ->
                Objects.equals(asset.getProjectId(), projectId)
                        && Objects.equals(asset.getUserId(), userId)
                        && Asset.TYPE_IMAGE.equals(asset.getType())
                        && Asset.STATUS_NORMAL.equals(asset.getStatus()));
        if (!allOwnedImages) {
            throw resourceNotFound();
        }
    }

    private GlobalException resourceNotFound() {
        return new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
    }

    private String requestHash(CreateGenerationJobRequest request) {
        String assetIds = request.inputAssetIds().stream()
                .map(String::valueOf)
                .collect(Collectors.joining(","));
        return Sha256.hex(request.type() + "\u0000" + request.parameters().prompt() + "\u0000"
                + request.parameters().aspectRatio() + "\u0000" + request.parameters().resolution()
                + "\u0000" + request.parameters().duration() + "\u0000" + assetIds + "\u0000"
                + request.expectedOutputCount() + "\u0000"
                + request.parameters().modelId() + "\u0000"
                + request.parameters().size() + "\u0000"
                + request.parameters().webSearch());
    }

    private GenerationModelCapability requireImageCapability(String modelId) {
        return capabilityMapper.selectEnabledByModelId(modelId)
                .orElseThrow(() -> new GlobalException(SystemCode.FAILURE_CODE,
                        "不支持的模型: " + modelId));
    }

    private String resolveSupportedSize(String requested, GenerationModelCapability capability) {
        String sizeId = (requested == null || requested.isBlank())
                ? capability.getDefaultSize() : requested;
        GenerationModelCapability.SizeOption option = capability.findSizeById(sizeId);
        if (option == null) {
            throw new GlobalException(SystemCode.FAILURE_CODE,
                    (sizeId == null || sizeId.isBlank())
                            ? "模型未配置可用尺寸" : "模型不支持该尺寸: " + sizeId);
        }
        return option.getId();
    }
}
