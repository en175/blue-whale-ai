package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.common.crypto.Sha256;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.CommandIdempotencyMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.dto.CreateGenerationJobRequest;
import com.blue.whale.agent.model.dto.CreateGenerationJobResponse;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.CommandIdempotency;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class GenerationJobCommandService {

    private static final String OPERATION = "generation_job.create.bottom_dock";

    private final ProjectService projectService;
    private final AssetMapper assetMapper;
    private final GenerationJobMapper generationJobMapper;
    private final CommandIdempotencyMapper idempotencyMapper;
    private final ProjectEventService projectEventService;

    @Transactional
    public CreateGenerationJobResponse create(
            Long projectId,
            Long userId,
            String idempotencyKey,
            CreateGenerationJobRequest request) {
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
        if (!GenerationJob.TYPE_IMAGE.equals(request.type())) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "暂不支持该生成类型");
        }
        requireOwnedInputAssets(projectId, userId, request.inputAssetIds());

        Map<String, Object> input = new LinkedHashMap<>();
        input.put("prompt", request.parameters().prompt());
        input.put("aspect_ratio", request.parameters().aspectRatio());
        if (!request.inputAssetIds().isEmpty()) {
            input.put("reference_asset_ids", request.inputAssetIds());
        }
        input.put("expected_output_count", request.expectedOutputCount());
        GenerationJob job = new GenerationJob()
                .setProjectId(projectId)
                .setUserId(userId)
                .setType(GenerationJob.TYPE_IMAGE)
                .setSource(GenerationJob.SOURCE_BOTTOM_DOCK)
                .setActionIdentity("bottom-dock:" + Sha256.hex(projectId + "\u0000" + OPERATION
                        + "\u0000" + idempotencyKey))
                .setInput(input)
                .setStatus(GenerationJob.STATUS_QUEUED)
                .setProgress(0)
                .setFencingToken(0L);
        generationJobMapper.insert(job);

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("job_id", job.getId());
        payload.put("action_identity", job.getActionIdentity());
        payload.put("type", job.getType());
        payload.put("source", job.getSource());
        payload.put("status", job.getStatus());
        payload.put("progress", job.getProgress());
        payload.put("input", job.getInput());
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

    private CreateGenerationJobResponse response(CommandIdempotency record) {
        return new CreateGenerationJobResponse(record.getGenerationJobId(), record.getAcceptedCursor());
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
                + request.parameters().aspectRatio() + "\u0000" + assetIds + "\u0000"
                + request.expectedOutputCount());
    }
}
