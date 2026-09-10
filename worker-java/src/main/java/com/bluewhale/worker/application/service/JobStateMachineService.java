package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.entity.ProjectEventEntity;
import com.bluewhale.worker.domain.entity.GenerationJobLogEntity;
import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;
import com.bluewhale.worker.domain.dto.ClaimedMediaExtractJobDto;
import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.dto.UpdateMediaExtractProgressDto;
import com.bluewhale.worker.domain.dto.PublishMediaExtractDto;
import com.bluewhale.worker.domain.dto.FailMediaExtractDto;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.mapper.ProjectEventMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationOutputSlotMapper;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Job 状态机服务（契约 §3 / 附录 B：claim / 租约 / 终态写入）。
 * <p>
 * 本服务是 Java 侧状态机权威实现（ADR-0084 修正二：Java 直连 DB 移植）。
 * 逐字移植自 TS Prisma 调用，注释标注 TS 源码行号。
 * <p>
 * Spring-managed singleton（设计约束：无 state-pattern 抽象）。
 */
@Service
public class JobStateMachineService {

    private static final Logger log = LoggerFactory.getLogger(JobStateMachineService.class);

    private static final int LEASE_SECONDS = 120; // 契约 §3.2：IMAGE_JOB_LEASE_SECONDS 默认 120s
    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();

    private final GenerationJobMapper jobMapper;
    private final AssetMapper assetMapper;
    private final GenerationJobLogMapper jobLogMapper;
    private final ProjectEventMapper projectEventMapper;
    private final GenerationOutputSlotMapper slotMapper;

    public JobStateMachineService(
            GenerationJobMapper jobMapper,
            AssetMapper assetMapper,
            GenerationJobLogMapper jobLogMapper,
            ProjectEventMapper projectEventMapper,
            GenerationOutputSlotMapper slotMapper
    ) {
        this.jobMapper = jobMapper;
        this.assetMapper = assetMapper;
        this.jobLogMapper = jobLogMapper;
        this.projectEventMapper = projectEventMapper;
        this.slotMapper = slotMapper;
    }

    // ========== 刀① media_extract 路径 ==========

    /**
     * 领取 media_extract 作业（claim-ops.ts:447-502）。
     */
    public Optional<ClaimedMediaExtractJobDto> claimMediaExtract(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        // 1. 候选查询（claim-ops.ts:450-467）
        GenerationJobEntity candidate = jobMapper.findMediaExtractCandidate(jobIdLong);
        if (candidate == null) {
            return Optional.empty();
        }

        // 2. CAS 更新（claim-ops.ts:472-486）
        LocalDateTime leaseExpiresAt = LocalDateTime.now().plusSeconds(LEASE_SECONDS);
        int affected = jobMapper.claimMediaExtractCas(
                jobIdLong,
                workerId,
                leaseExpiresAt,
                candidate.getFencingToken(),
                candidate.getStatus()
        );

        if (affected == 0) {
            return Optional.empty();
        }

        // 3. 返回投影（claim-ops.ts:489-501）
        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());

        return Optional.of(new ClaimedMediaExtractJobDto(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                input != null ? input : Map.of(),
                workerId,
                postIncrementToken
        ));
    }

    /**
     * 更新 media_extract 进度（media-extract-ops.ts:26-43）。
     */
    public boolean updateMediaExtractProgress(UpdateMediaExtractProgressDto input) {
        Long jobIdLong = Long.parseLong(input.jobId());
        int clampedProgress = Math.max(0, Math.min(99, Math.round((float) input.progress())));
        LocalDateTime leaseExpiresAt = LocalDateTime.now().plusSeconds(LEASE_SECONDS);
        int affected = jobMapper.updateMediaExtractProgress(
                jobIdLong, input.workerId(), input.fencingToken(),
                clampedProgress, leaseExpiresAt);
        return affected == 1;
    }

    /**
     * 发布 media_extract 结果（media-extract-ops.ts:45-135）。
     */
    @Transactional
    public boolean publishMediaExtractResult(PublishMediaExtractDto input) {
        Long jobIdLong = Long.parseLong(input.jobId());

        int guardAffected = jobMapper.publishMediaExtractGuard(
                jobIdLong, input.workerId(), input.fencingToken());
        if (guardAffected != 1) {
            return false;
        }

        AssetEntity asset = new AssetEntity();
        asset.setUserId(Long.parseLong(input.userId()));
        asset.setProjectId(Long.parseLong(input.projectId()));
        asset.setGenerationJobId(jobIdLong);
        asset.setType("audio");
        asset.setUrl(input.url());
        asset.setStorageKey(input.storageKey());
        asset.setMime(input.mime());
        asset.setSize(input.size());
        if (input.duration() != null) {
            asset.setDurationMs((int) Math.round(input.duration() * 1000));
        }
        asset.setSource("generated");
        asset.setStatus("normal");
        asset.setGmtCreate(LocalDateTime.now());
        asset.setGmtModified(LocalDateTime.now());
        asset.setVersion(0);
        asset.setIsDelete(false);
        assetMapper.insert(asset);

        String outputAssetIdsJson = "[" + asset.getId() + "]";
        jobMapper.updateOutputAssetIds(jobIdLong, outputAssetIdsJson);

        GenerationJobLogEntity logEntry = new GenerationJobLogEntity();
        logEntry.setGenerationJobId(jobIdLong);
        logEntry.setEvent("succeeded");
        logEntry.setStatus("succeeded");
        logEntry.setMessage("音频已提取");
        logEntry.setPayload(toJson(Map.of("asset_ids", List.of(asset.getId().toString()))));
        logEntry.setOccurredAt(LocalDateTime.now());
        jobLogMapper.insert(logEntry);

        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        if (job != null && job.getProjectId() != null) {
            appendProjectEvent(job.getProjectId(), "asset.created", "asset",
                    asset.getId().toString(), asset.getVersion(),
                    "job_" + job.getId().toString(),
                    Map.of("asset_id", asset.getId().toString(),
                            "generation_job_id", job.getId().toString(),
                            "type", asset.getType(),
                            "access_url", asset.getUrl()));
            appendProjectEvent(job.getProjectId(), "generation_job.status_changed",
                    "generation_job", job.getId().toString(), job.getVersion(),
                    "job_" + job.getId().toString(),
                    Map.of("job_id", job.getId().toString(),
                            "type", job.getType(),
                            "source", job.getSource(),
                            "status", job.getStatus(),
                            "progress", job.getProgress(),
                            "output_asset_ids", List.of(asset.getId().toString())));
        }
        return true;
    }

    /**
     * 失败 media_extract 作业（media-extract-ops.ts:138-192）。
     */
    @Transactional
    public boolean failMediaExtractJob(FailMediaExtractDto input) {
        Long jobIdLong = Long.parseLong(input.jobId());

        Map<String, Object> errorObj = new HashMap<>();
        errorObj.put("code", input.code());
        errorObj.put("message", input.message());
        if (input.details() != null) {
            errorObj.put("details", input.details());
        }
        String errorJson = toJson(errorObj);

        int guardAffected = jobMapper.failMediaExtractGuard(
                jobIdLong, input.workerId(), input.fencingToken(), errorJson);
        if (guardAffected != 1) {
            return false;
        }

        GenerationJobLogEntity logEntry = new GenerationJobLogEntity();
        logEntry.setGenerationJobId(jobIdLong);
        logEntry.setEvent("failed");
        logEntry.setStatus("failed");
        logEntry.setMessage(input.code() + ": " + input.message());
        logEntry.setOccurredAt(LocalDateTime.now());
        jobLogMapper.insert(logEntry);

        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        if (job != null && job.getProjectId() != null) {
            appendProjectEvent(job.getProjectId(), "generation_job.status_changed",
                    "generation_job", job.getId().toString(), job.getVersion(),
                    "job_" + job.getId().toString(),
                    Map.of("job_id", job.getId().toString(),
                            "type", job.getType(),
                            "source", job.getSource(),
                            "status", job.getStatus(),
                            "progress", job.getProgress(),
                            "error", Map.of("code", input.code(), "message", input.message())));
        }
        return true;
    }

    // ========== 刀② 音频路径（blade-② IKCR78） ==========

    /**
     * 领取音频作业（claim-ops.ts:388-445 claimAudioJobById）。
     * <p>
     * 两段式 CAS（契约 §3.1）：
     * 1. SELECT candidate WHERE id=? AND type='audio' AND is_delete=false
     *    AND next_action_at&lt;=now AND (queued OR processing+孤儿)
     * 2. UPDATE CAS: status='processing', lease_owner=?, lease_expires_at=now+120s,
     *    last_polled_at=now, fencing_token+1, version+1
     * <p>
     * 返回投影用增后 token（candidate.fencing_token + 1）。
     * <b>不套 source 白名单</b>（IKCR78/IKC9EJ 教训对齐 media_extract）。
     * <b>NO .catch on by-id</b>（契约 §3.1 不对称：DB 异常上抛）。
     * <p>
     * 投影为 snake_case ClaimedJobDto（与 TS ClaimedJob types.ts:3-16 逐字一致）。
     */
    public Optional<ClaimedJobDto> claimAudioJobById(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        // 1. 候选查询（claim-ops.ts:395-413）
        GenerationJobEntity candidate = jobMapper.findAudioCandidate(jobIdLong);
        if (candidate == null) {
            return Optional.empty();
        }

        // 2. CAS 更新（claim-ops.ts:417-431）
        LocalDateTime leaseExpiresAt = LocalDateTime.now().plusSeconds(LEASE_SECONDS);
        int affected = jobMapper.claimAudioCas(
                jobIdLong,
                workerId,
                leaseExpiresAt,
                candidate.getFencingToken(),
                candidate.getStatus()
        );

        if (affected == 0) {
            return Optional.empty();
        }

        // 3. 返回 snake_case 投影（claim-ops.ts:434-444）
        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());

        return Optional.of(new ClaimedJobDto(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                candidate.getType(),
                input != null ? input : Map.of(),
                candidate.getExpectedOutputCount() != null ? candidate.getExpectedOutputCount() : 1,
                candidate.getRetryCount() != null ? candidate.getRetryCount() : 0,
                candidate.getCancelRequestedAt() != null,
                postIncrementToken
        ));
    }

    /**
     * 完成作业（settle-ops.ts:53-206 completeJob + completeJobInTx）。
     * <p>
     * 单事务原子操作（@Transactional）：
     * 1. fence guard CAS → status='succeeded', progress=100, output_asset_ids, 清租约
     * 2. 槽位聚合（generation_output_slots → 可能修正为 partially_succeeded）
     * 3. project_events（generation_job.status_changed + output_attached/output_updated）
     * <p>
     * <b>修正一</b>：cost_reservations 结算不在实现范围（settle-ops.ts:228 settleReservationInTx
     * 整块按修正一省略；completeJobAndSettle 退化为 completeJob 语义）。
     * <p>
     * 音频/图片共用此路径（generation-worker.ts:445/684 finishJob）。
     *
     * @return true = 守卫通过并完成；false = 守卫失败（stale worker）
     */
    @Transactional
    public boolean completeJob(String jobId, List<String> assetIds,
                               String workerId, long fencingToken) {
        Long jobIdLong = Long.parseLong(jobId);

        // 1. fence guard CAS（settle-ops.ts:65-77）
        String outputAssetIdsJson = toJson(assetIds.stream().map(Long::parseLong).toList());
        int guardAffected = jobMapper.completeJobGuard(
                jobIdLong, workerId, fencingToken, outputAssetIdsJson);
        if (guardAffected != 1) {
            return false;
        }

        // 2. 槽位聚合（settle-ops.ts:79-121）
        List<GenerationOutputSlotEntity> slots = slotMapper.findByJobId(jobIdLong);
        String finalStatus = "succeeded";
        if (!slots.isEmpty()) {
            // 成功 asset 绑定对应 slot_index（settle-ops.ts:85-93）
            for (int i = 0; i < assetIds.size(); i++) {
                if (i < slots.size()) {
                    slotMapper.updateSlot(slots.get(i).getId(), "succeeded",
                            Long.parseLong(assetIds.get(i)));
                }
            }
            // 未匹配到成功 asset 的剩余槽标 failed（settle-ops.ts:95-102）
            for (int i = assetIds.size(); i < slots.size(); i++) {
                slotMapper.updateSlotStatus(slots.get(i).getId(), "failed");
            }
            // 聚合 job 状态（settle-ops.ts:104-114）
            boolean allSucceeded = assetIds.size() >= slots.size();
            boolean anySucceeded = !assetIds.isEmpty();
            if (allSucceeded) {
                finalStatus = "succeeded";
            } else if (anySucceeded) {
                finalStatus = "partially_succeeded";
            } else {
                finalStatus = "failed";
            }
            // 修正占位状态（settle-ops.ts:116-121）
            if (!"succeeded".equals(finalStatus)) {
                jobMapper.updateJobStatus(jobIdLong, finalStatus);
            }
        }

        // 3. 读回 job 完整行（settle-ops.ts:122-129）
        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        if (job == null) {
            throw new IllegalStateException(
                    "completeJob 守卫通过后任务 " + jobId + " 不存在，数据损坏");
        }
        if (job.getProjectId() == null) {
            return true; // 无 project_id → 跳过事件（settle-ops.ts:130）
        }

        // 4. project_events（settle-ops.ts:131-194）
        appendProjectEvent(job.getProjectId(), "generation_job.status_changed",
                "generation_job", job.getId().toString(), job.getVersion(),
                "job_" + job.getId().toString(),
                Map.of("job_id", job.getId().toString(),
                        "type", job.getType(),
                        "source", job.getSource(),
                        "status", job.getStatus(),
                        "progress", job.getProgress(),
                        "output_asset_ids", assetIds));

        for (int i = 0; i < assetIds.size(); i++) {
            GenerationOutputSlotEntity slot = i < slots.size() ? slots.get(i) : null;
            int slotIndex = slot != null ? slot.getSlotIndex() : i;
            appendProjectEvent(job.getProjectId(), "generation_job.output_attached",
                    "generation_job_output",
                    job.getId().toString() + ":" + slotIndex,
                    0,
                    "job_" + job.getId().toString(),
                    Map.of("job_id", job.getId().toString(),
                            "slot_id", slot != null ? slot.getId().toString() : "",
                            "slot_index", slotIndex,
                            "status", "succeeded",
                            "asset_id", assetIds.get(i),
                            "retry_of_slot_id", slot != null && slot.getRetryOfSlotId() != null
                                    ? slot.getRetryOfSlotId().toString() : "",
                            "initial_placement_status", "pending"));
        }

        for (int i = assetIds.size(); i < slots.size(); i++) {
            GenerationOutputSlotEntity slot = slots.get(i);
            appendProjectEvent(job.getProjectId(), "generation_job.output_updated",
                    "generation_job_output",
                    job.getId().toString() + ":" + slot.getSlotIndex(),
                    0,
                    "job_" + job.getId().toString(),
                    Map.of("job_id", job.getId().toString(),
                            "slot_id", slot.getId().toString(),
                            "slot_index", slot.getSlotIndex(),
                            "status", "failed",
                            "asset_id", "",
                            "retry_of_slot_id", slot.getRetryOfSlotId() != null
                                    ? slot.getRetryOfSlotId().toString() : "",
                            "initial_placement_status", "pending"));
        }

        // 按修正一省略：settleReservationInTx（settle-ops.ts:228 整块删除）
        // 按修正一省略：syncRecordSummary / syncStoryboardPreviewSummary
        // （音频 job 不走 scene_card / storyboard 路径，此处不编造逻辑）

        return true;
    }

    /**
     * 失败作业（settle-ops.ts:233-336 failJob）。
     * <p>
     * 单事务原子操作（@Transactional）：
     * 1. fence guard CAS → status='failed', error={code,message,details?}, 清租约
     * 2. pending 槽位 → failed
     * 3. generation_job_logs
     * 4. project_events（generation_job.status_changed + output_updated）
     * <p>
     * <b>修正一</b>：releaseReservationInTx（settle-ops.ts:333）整块按修正一省略。
     */
    @Transactional
    public boolean failJob(String jobId, String errorCode, String errorMessage,
                           Map<String, Object> details,
                           String workerId, long fencingToken) {
        Long jobIdLong = Long.parseLong(jobId);

        // 1. fence guard CAS（settle-ops.ts:238-253）
        Map<String, Object> errorObj = new HashMap<>();
        errorObj.put("code", errorCode);
        errorObj.put("message", errorMessage);
        if (details != null) {
            errorObj.put("details", details);
        }
        String errorJson = toJson(errorObj);

        int guardAffected = jobMapper.failJobGuard(
                jobIdLong, workerId, fencingToken, errorJson);
        if (guardAffected != 1) {
            return false;
        }

        // 2. pending 槽位 → failed（settle-ops.ts:255-263）
        List<GenerationOutputSlotEntity> slots = slotMapper.findPendingByJobId(jobIdLong);
        for (GenerationOutputSlotEntity slot : slots) {
            slotMapper.updateSlotStatus(slot.getId(), "failed");
        }

        // 3. 读回 job（settle-ops.ts:264-271）
        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        if (job == null) {
            throw new IllegalStateException(
                    "failJob 守卫通过后任务 " + jobId + " 不存在，数据损坏");
        }

        // 4. generation_job_logs（settle-ops.ts:272-279）
        GenerationJobLogEntity logEntry = new GenerationJobLogEntity();
        logEntry.setGenerationJobId(jobIdLong);
        logEntry.setEvent("failed");
        logEntry.setStatus("failed");
        logEntry.setMessage(errorCode + ": " + errorMessage);
        logEntry.setOccurredAt(LocalDateTime.now());
        jobLogMapper.insert(logEntry);

        // 5. project_events（settle-ops.ts:280-319）
        if (job.getProjectId() != null) {
            appendProjectEvent(job.getProjectId(), "generation_job.status_changed",
                    "generation_job", job.getId().toString(), job.getVersion(),
                    "job_" + job.getId().toString(),
                    Map.of("job_id", job.getId().toString(),
                            "type", job.getType(),
                            "source", job.getSource(),
                            "status", job.getStatus(),
                            "progress", job.getProgress(),
                            "error", Map.of("code", errorCode, "message", errorMessage)));

            for (GenerationOutputSlotEntity slot : slots) {
                appendProjectEvent(job.getProjectId(), "generation_job.output_updated",
                        "generation_job_output",
                        job.getId().toString() + ":" + slot.getSlotIndex(),
                        0,
                        "job_" + job.getId().toString(),
                        Map.of("job_id", job.getId().toString(),
                                "slot_id", slot.getId().toString(),
                                "slot_index", slot.getSlotIndex(),
                                "status", "failed",
                                "asset_id", "",
                                "retry_of_slot_id", slot.getRetryOfSlotId() != null
                                        ? slot.getRetryOfSlotId().toString() : "",
                                "initial_placement_status", "pending",
                                "error", Map.of("code", errorCode, "message", errorMessage)));
            }
        }

        // 按修正一省略：releaseReservationInTx（settle-ops.ts:333）
        // 按修正一省略：syncRecordSummary / syncStoryboardPreviewSummary

        return true;
    }

    /**
     * 创建资产（asset-ops.ts:151-202 createAsset）。
     * <p>
     * 单事务原子操作（@Transactional）：
     * 1. fence CAS 守卫（version 自增占位，不改 status）
     * 2. 建资产行（source='generated', status='normal'）
     * 3. asset.created 事件
     * <p>
     * count≠1 → stale worker → 返回 null（asset-ops.ts:165）。
     * <p>
     * 音频：mime 恒 audio/mpeg（契约 §8）；duration 秒→毫秒（asset-ops.ts:178-180）。
     *
     * @return 资产 id（字符串）；null = 守卫失败
     */
    @Transactional
    public String createAsset(CreateAssetInput input) {
        Long jobIdLong = Long.parseLong(input.generationJobId());

        // 1. fence CAS 守卫（asset-ops.ts:156-165）
        int guardAffected = jobMapper.createAssetGuard(
                jobIdLong, input.workerId(), input.fencingToken());
        if (guardAffected != 1) {
            return null;
        }

        // 2. 建资产行（asset-ops.ts:166-185）
        AssetEntity asset = new AssetEntity();
        asset.setUserId(Long.parseLong(input.userId()));
        asset.setProjectId(Long.parseLong(input.projectId()));
        asset.setGenerationJobId(jobIdLong);
        asset.setType(input.type());
        asset.setUrl(input.url());
        asset.setStorageKey(input.storageKey());
        asset.setMime(input.mime());
        asset.setSize(input.size());
        asset.setWidth(input.width());
        asset.setHeight(input.height());
        // duration 秒→毫秒（asset-ops.ts:178-180：Math.round(input.duration * 1000)）
        if (input.duration() != null) {
            asset.setDurationMs((int) Math.round(input.duration() * 1000));
        }
        asset.setSource("generated");
        asset.setStatus("normal");
        asset.setGmtCreate(LocalDateTime.now());
        asset.setGmtModified(LocalDateTime.now());
        asset.setVersion(0);
        asset.setIsDelete(false);
        assetMapper.insert(asset);

        // 3. asset.created 事件（asset-ops.ts:186-199）
        Long projectIdLong = Long.parseLong(input.projectId());
        appendProjectEvent(projectIdLong, "asset.created", "asset",
                asset.getId().toString(), asset.getVersion(),
                "job_" + jobIdLong,
                Map.of("asset_id", asset.getId().toString(),
                        "generation_job_id", input.generationJobId(),
                        "type", asset.getType(),
                        "access_url", asset.getUrl()));

        return asset.getId().toString();
    }

    /**
     * 追加作业日志（settle-ops.ts:365-374 appendLog）。
     * <p>
     * 非事务性——日志写入不参与 fence 守卫。
     */
    public void appendLog(String jobId, String event, String status,
                          String message, Map<String, Object> payload) {
        Long jobIdLong = Long.parseLong(jobId);
        GenerationJobLogEntity logEntry = new GenerationJobLogEntity();
        logEntry.setGenerationJobId(jobIdLong);
        logEntry.setEvent(event);
        logEntry.setStatus(status);
        if (message != null) {
            logEntry.setMessage(message);
        }
        if (payload != null) {
            logEntry.setPayload(toJson(payload));
        }
        logEntry.setOccurredAt(LocalDateTime.now());
        jobLogMapper.insert(logEntry);
    }

    // ========== 内部工具 ==========

    private void appendProjectEvent(
            Long projectId, String eventType, String aggregateType,
            String aggregateId, Integer aggregateVersion,
            String correlationId, Map<String, Object> payload
    ) {
        Long cursor = projectEventMapper.nextCursor(projectId);
        ProjectEventEntity event = new ProjectEventEntity();
        event.setProjectId(projectId);
        event.setCursor(cursor);
        event.setEventId(UUID.randomUUID().toString());
        event.setEventType(eventType);
        event.setAggregateType(aggregateType);
        event.setAggregateId(aggregateId);
        event.setAggregateVersion(aggregateVersion);
        event.setCorrelationId(correlationId);
        event.setOccurredAt(LocalDateTime.now());
        event.setPayload(toJson(payload));
        event.setGmtCreate(LocalDateTime.now());
        event.setGmtModified(LocalDateTime.now());
        event.setVersion(0);
        event.setIsDelete(0);
        projectEventMapper.insert(event);
    }

    Map<String, Object> parseJson(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return JSON_MAPPER.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (JsonProcessingException e) {
            return null;
        }
    }

    String toJson(Object obj) {
        try {
            return JSON_MAPPER.writeValueAsString(obj);
        } catch (JsonProcessingException e) {
            throw new RuntimeException("Failed to serialize to JSON", e);
        }
    }

    /**
     * createAsset 输入（对齐 TS WorkerRepo.createAsset 参数，asset-ops.ts:151-202）。
     */
    public record CreateAssetInput(
            String userId,
            String projectId,
            String generationJobId,
            String type,
            String url,
            String storageKey,
            String mime,
            Long size,
            Integer width,
            Integer height,
            Double duration,
            String workerId,
            long fencingToken
    ) {}
}
