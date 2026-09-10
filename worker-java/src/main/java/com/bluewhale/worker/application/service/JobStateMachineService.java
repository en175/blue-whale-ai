package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.entity.ProjectEventEntity;
import com.bluewhale.worker.domain.entity.GenerationJobLogEntity;
import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;
import com.bluewhale.worker.domain.entity.SceneCardGenerationRecordEntity;
import com.bluewhale.worker.domain.entity.StoryboardPreviewEntity;
import com.bluewhale.worker.domain.dto.ClaimedMediaExtractJobDto;
import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.dto.ClaimedVideoJobDto;
import com.bluewhale.worker.domain.dto.UpdateMediaExtractProgressDto;
import com.bluewhale.worker.domain.dto.PublishMediaExtractDto;
import com.bluewhale.worker.domain.dto.FailMediaExtractDto;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.mapper.ProjectEventMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.mapper.SceneCardGenerationRecordMapper;
import com.bluewhale.worker.infrastructure.mapper.StoryboardPreviewMapper;

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
    private final SceneCardGenerationRecordMapper sceneCardRecordMapper;
    private final StoryboardPreviewMapper storyboardPreviewMapper;

    public JobStateMachineService(
            GenerationJobMapper jobMapper,
            AssetMapper assetMapper,
            GenerationJobLogMapper jobLogMapper,
            ProjectEventMapper projectEventMapper,
            GenerationOutputSlotMapper slotMapper,
            SceneCardGenerationRecordMapper sceneCardRecordMapper,
            StoryboardPreviewMapper storyboardPreviewMapper
    ) {
        this.jobMapper = jobMapper;
        this.assetMapper = assetMapper;
        this.jobLogMapper = jobLogMapper;
        this.projectEventMapper = projectEventMapper;
        this.slotMapper = slotMapper;
        this.sceneCardRecordMapper = sceneCardRecordMapper;
        this.storyboardPreviewMapper = storyboardPreviewMapper;
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

    // ========== 图片路径（blade-③ IKELJA） ==========

    /**
     * 领取图片作业（claim-ops.ts:331-386 claimImageJobById）。
     * <p>
     * 两段式 CAS（契约 §3.1）：
     * 1. SELECT candidate WHERE id=? AND type='image' AND source IN 白名单
     *    AND is_delete=false AND next_action_at&lt;=now AND (queued OR processing+孤儿)
     * 2. UPDATE CAS: status='processing', lease_owner=?, lease_expires_at=now+120s,
     *    last_polled_at=now, fencing_token+1, version+1
     * <p>
     * 返回投影用增后 token（candidate.fencing_token + 1）。
     * <b>套 source 白名单</b>（与 audio 不同：claimImageJobById :339 source IN CLAIMABLE_JOB_SOURCES）。
     * <b>NO .catch on by-id</b>（契约 §3.1 不对称：DB 异常上抛）。
     */
    public Optional<ClaimedJobDto> claimImageJobById(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        // 1. 候选查询（claim-ops.ts:335-354）
        GenerationJobEntity candidate = jobMapper.findImageCandidate(jobIdLong);
        if (candidate == null) {
            return Optional.empty();
        }

        // 2. CAS 更新（claim-ops.ts:358-372）
        LocalDateTime leaseExpiresAt = LocalDateTime.now().plusSeconds(LEASE_SECONDS);
        int affected = jobMapper.claimImageCas(
                jobIdLong,
                workerId,
                leaseExpiresAt,
                candidate.getFencingToken(),
                candidate.getStatus()
        );

        if (affected == 0) {
            return Optional.empty();
        }

        // 3. 返回 snake_case 投影（claim-ops.ts:375-385）
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
     * 瞬态重试：图片作业回 queued（claim-ops.ts:561-578 requeueImageJobForRetry）。
     * <p>
     * WHERE id=? AND status='processing'（无 fence 入参——与 TS SQL 逐字一致，
     * 契约附录 B 注：「无 fence 入参——Java 移植时以其 SQL 实况为准」）。
     * <p>
     * SET status='queued', lease_owner=null, lease_expires_at=null,
     *     next_action_at=?, retry_count+1, fencing_token+1, version+1
     * <p>
     * DB 异常 → .catch → count=0 → false（不抛；claim-ops.ts:577）。
     *
     * @param jobId        作业 ID
     * @param nextActionAt 下次可执行时间（caller 计算退避，generation-worker.ts:84-87）
     * @return true = 重排成功；false = 守卫失败或 DB 异常
     */
    public boolean requeueImageJobForRetry(String jobId, LocalDateTime nextActionAt) {
        Long jobIdLong = Long.parseLong(jobId);
        try {
            int affected = jobMapper.requeueImageCas(jobIdLong, nextActionAt);
            return affected > 0;
        } catch (Exception e) {
            // .catch(() => ({count:0}))（claim-ops.ts:577）
            log.warn("requeueImageJobForRetry DB 异常 jobId={}: {}", jobId, e.getMessage());
            return false;
        }
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

        // 5. syncRecordSummary（settle-ops.ts:196-201）：firstSlot 关联 record 时回写
        GenerationOutputSlotEntity firstSlot = slots.isEmpty() ? null : slots.get(0);
        if (firstSlot != null && firstSlot.getSceneCardGenerationRecordId() != null) {
            syncRecordSummary(firstSlot.getSceneCardGenerationRecordId());
        }

        // 6. syncStoryboardPreviewSummary（settle-ops.ts:203-204）：无条件调用，
        //    内部 null-guard（findFirst 无命中 → 立即返回）
        syncStoryboardPreviewSummary(jobIdLong);

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

        // syncRecordSummary（settle-ops.ts:322-327）：firstSlot 关联 record 时回写
        GenerationOutputSlotEntity firstFailSlot = slots.isEmpty() ? null : slots.get(0);
        if (firstFailSlot != null && firstFailSlot.getSceneCardGenerationRecordId() != null) {
            syncRecordSummary(firstFailSlot.getSceneCardGenerationRecordId());
        }

        // syncStoryboardPreviewSummary（settle-ops.ts:329-330）：无条件调用
        syncStoryboardPreviewSummary(jobIdLong);

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

    // ========== 摘要同步（generation-worker-internals.ts:18-113） ==========

    /**
     * 聚合 record 下全部输出槽状态，回写 SceneCardGenerationRecord.summary_status
     * （internals.ts:21-62 syncRecordSummary 逐字移植）。
     * <p>
     * spec §4.4 状态机：全成功→success；部分→partial；全失败→failed；有 pending→generating。
     * <p>
     * 在 completeJob/failJob 事务内调用，保证槽位与 record 状态原子一致。
     * null-guard：firstSlot.scene_card_generation_record_id == null → 不调用。
     */
    private void syncRecordSummary(Long recordId) {
        List<GenerationOutputSlotEntity> slots = slotMapper.findBySceneCardRecordId(recordId);
        if (slots.isEmpty()) return;

        String summary = aggregateSlotStatus(resolveLogicalSlots(slots));
        int affected = sceneCardRecordMapper.updateSummaryStatus(recordId, summary);
        if (affected != 1) return;

        // 回读 version 用于事件（internals.ts:51-61）
        SceneCardGenerationRecordEntity record = sceneCardRecordMapper.selectById(recordId);
        if (record != null && record.getProjectId() != null) {
            appendProjectEvent(record.getProjectId(),
                    "scene_card_generation_record.summary_changed",
                    "scene_card_generation_record",
                    recordId.toString(),
                    record.getVersion(),
                    "record_" + recordId.toString(),
                    Map.of("record_id", recordId.toString(),
                            "summary_status", summary));
        }
    }

    /**
     * 回写 StoryboardPreview.summary_status（internals.ts:67-113 syncStoryboardPreviewSummary）。
     * <p>
     * 按 first_generation_job_id 反查预览，聚合该 job 的 output_slots 推进汇总态。
     * 与 syncRecordSummary 对偶——视频走 record 外键，图片 job 不设该外键故走本路径。
     * <p>
     * null-guard：findFirst 无命中 → 立即返回（internals.ts:75）。
     */
    private void syncStoryboardPreviewSummary(Long jobId) {
        StoryboardPreviewEntity preview =
                storyboardPreviewMapper.findByFirstGenerationJobId(jobId);
        if (preview == null) return;

        List<GenerationOutputSlotEntity> slots = slotMapper.findByJobId(jobId);
        if (slots.isEmpty()) return;

        String summary = aggregateSlotStatus(resolveLogicalSlots(slots));
        int affected = storyboardPreviewMapper.updateSummaryStatus(preview.getId(), summary);
        if (affected != 1) return;

        if (preview.getProjectId() != null) {
            // 回读 version（internals.ts:102-112）
            StoryboardPreviewEntity updated =
                    storyboardPreviewMapper.selectById(preview.getId());
            int version = updated != null && updated.getVersion() != null
                    ? updated.getVersion() : 0;
            appendProjectEvent(preview.getProjectId(),
                    "storyboard_preview.summary_changed",
                    "storyboard_preview",
                    preview.getId().toString(),
                    version,
                    "preview_" + preview.getId().toString(),
                    Map.of("preview_id", preview.getId().toString(),
                            "summary_status", summary));
        }
    }

    /**
     * 逻辑槽折叠（generation-output-slot-repo.ts:28-43 resolveLogicalSlots）。
     * <p>
     * 同一 slot_index 的历史尝试折叠为一个逻辑槽：
     * succeeded 是永久终态——若当前逻辑槽已 succeeded 则保留；否则以最新尝试（id 最大）为准。
     * 结果按 slot_index 升序排列。
     */
    static List<GenerationOutputSlotEntity> resolveLogicalSlots(
            List<GenerationOutputSlotEntity> slots) {
        // LinkedHashMap 保插入序；最后按 slotIndex 排序
        Map<Integer, GenerationOutputSlotEntity> resolved = new java.util.LinkedHashMap<>();
        for (GenerationOutputSlotEntity slot : slots) {
            GenerationOutputSlotEntity current = resolved.get(slot.getSlotIndex());
            if (current == null
                    || !"succeeded".equals(current.getStatus())
                    || "succeeded".equals(slot.getStatus())) {
                resolved.put(slot.getSlotIndex(), slot);
            }
        }
        return resolved.values().stream()
                .sorted(java.util.Comparator.comparingInt(GenerationOutputSlotEntity::getSlotIndex))
                .toList();
    }

    /**
     * 槽位聚合汇总状态（generation-output-slot-repo.ts:15-24 aggregateSlotStatus）。
     * <p>
     * spec §4.4 状态机：
     * - 全 succeeded → success
     * - 全 failed/missing → failed
     * - 至少一个 succeeded 且至少一个 failed/missing → partial
     * - 存在 pending → generating（尚有未终态槽）
     * <p>
     * 注意：record/preview summary 四态（generating/partial/success/failed）与
     * job status（succeeded/partially_succeeded/failed）是不同枚举，不混淆。
     */
    static String aggregateSlotStatus(List<GenerationOutputSlotEntity> resolvedSlots) {
        if (resolvedSlots.isEmpty()) return "failed";
        boolean hasPending = resolvedSlots.stream()
                .anyMatch(s -> "pending".equals(s.getStatus()));
        if (hasPending) return "generating";
        long succeeded = resolvedSlots.stream()
                .filter(s -> "succeeded".equals(s.getStatus())).count();
        if (succeeded == resolvedSlots.size()) return "success";
        if (succeeded == 0) return "failed";
        return "partial";
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

    // ========== 刀④ 视频路径（blade-④ IKEL9A） ==========

    /**
     * 领取视频作业（claim-ops.ts:255-330 claimVideoJobById）。
     * <p>
     * 两段式 CAS（契约 §3.1）：
     * 1. SELECT candidate WHERE id=? AND type='video' AND source IN 白名单
     *    AND is_delete=false AND next_action_at&lt;=now AND (queued OR processing+孤儿)
     * 2. UPDATE CAS: status='processing', lease_owner=?, lease_expires_at=now+120s,
     *    last_polled_at=now, fencing_token+1, version+1
     * <p>
     * 投影为 ClaimedVideoJobDto（含 pollCount/progress/providerTaskId/parentProviderTaskId）。
     * <p>
     * parentProviderTaskId：retry_of_job_id 非空时查父 job 的 provider_task_id
     * （IKEA26 防双扣：retry job 先查上游旧 task 状态）。
     * <p>
     * <b>修正一</b>：reservedAmountFen 不在投影范围。
     */
    public Optional<ClaimedVideoJobDto> claimVideoJobById(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        // 1. 候选查询（claim-ops.ts:261-290）
        GenerationJobEntity candidate = jobMapper.findVideoCandidate(jobIdLong);
        if (candidate == null) {
            return Optional.empty();
        }

        // 2. CAS 更新（claim-ops.ts:295-315）
        LocalDateTime leaseExpiresAt = LocalDateTime.now().plusSeconds(LEASE_SECONDS);
        int affected = jobMapper.claimVideoCas(
                jobIdLong,
                workerId,
                leaseExpiresAt,
                candidate.getFencingToken(),
                candidate.getStatus()
        );

        if (affected == 0) {
            return Optional.empty();
        }

        // 3. 返回投影（claim-ops.ts:318-330）
        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());

        // IKEA26：parentProviderTaskId = retry_of_job_id 关联的父 job 的 provider_task_id
        String parentProviderTaskId = null;
        if (candidate.getRetryOfJobId() != null) {
            parentProviderTaskId = jobMapper.findProviderTaskId(candidate.getRetryOfJobId());
        }

        return Optional.of(new ClaimedVideoJobDto(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                input != null ? input : Map.of(),
                candidate.getProviderTaskId(),
                candidate.getCancelRequestedAt() != null,
                workerId,
                postIncrementToken,
                candidate.getPollCount() != null ? candidate.getPollCount() : 0,
                candidate.getProgress() != null ? candidate.getProgress() : 0,
                parentProviderTaskId
        ));
    }

    /**
     * 标记视频已提交（video-ops.ts:14-30 markVideoSubmitted）。
     * <p>
     * 写入 provider_task_id + 释放租约 + next_action_at=now+5000ms。
     * 金色 G09-G11 pin 这些字段。
     */
    public boolean markVideoSubmitted(String jobId, String workerId,
                                      long fencingToken, String providerTaskId) {
        Long jobIdLong = Long.parseLong(jobId);
        // 与 TS video-ops.ts:10,15 同调：next = now + 5000ms，Java 侧计算（评审 C1）。
        java.time.LocalDateTime nextPollAt = java.time.LocalDateTime.now().plusNanos(5_000L * 1_000_000);
        int affected = jobMapper.markVideoSubmitted(jobIdLong, workerId, fencingToken, providerTaskId, nextPollAt);
        return affected == 1;
    }

    /**
     * 重排视频轮询（video-ops.ts:32-57 rescheduleVideoPoll）。
     * <p>
     * poll_count+1 + progress 保持 + 释放租约 + next_action_at=now+5000ms。
     */
    public boolean rescheduleVideoPoll(String jobId, String workerId,
                                       long fencingToken, int progress) {
        Long jobIdLong = Long.parseLong(jobId);
        // 评审 C2：钳制在 Java 侧做，逐字对齐 video-ops.ts:47 的 Math.max(0,Math.min(99,Math.round(..)))。
        int clamped = Math.max(0, Math.min(99, progress));
        java.time.LocalDateTime now = java.time.LocalDateTime.now();
        java.time.LocalDateTime nextPollAt = now.plusNanos(5_000L * 1_000_000);
        int affected = jobMapper.rescheduleVideoPoll(jobIdLong, workerId, fencingToken, clamped, now, nextPollAt);
        return affected == 1;
    }

    /**
     * 发布视频结果（video-ops.ts:60-198 publishVideoResult）。
     * <p>
     * 事务：publishVideoGuard + createAsset + output_asset_ids + log + events。
     * <p>
     * <b>修正一</b>：settle 段整体省略（actual_amount_fen 不写）。
     */
    @Transactional
    public boolean publishVideoResult(String jobId, String projectId, String userId,
                                      String workerId, long fencingToken,
                                      String url, String storageKey, String mime, Long size,
                                      int width, int height, double duration) {
        Long jobIdLong = Long.parseLong(jobId);

        // 1. publishVideoGuard CAS
        int guardAffected = jobMapper.publishVideoGuard(jobIdLong, workerId, fencingToken);
        if (guardAffected != 1) {
            return false;
        }

        // 2. createAsset（视频 type=video）
        AssetEntity asset = new AssetEntity();
        asset.setUserId(Long.parseLong(userId));
        asset.setProjectId(Long.parseLong(projectId));
        asset.setGenerationJobId(jobIdLong);
        asset.setType("video");
        asset.setUrl(url);
        asset.setStorageKey(storageKey);
        asset.setMime(mime);
        asset.setSize(size);
        asset.setWidth(width);
        asset.setHeight(height);
        if (duration > 0) {
            asset.setDurationMs((int) Math.round(duration * 1000));
        }
        asset.setSource("generated");
        asset.setStatus("normal");
        asset.setGmtCreate(LocalDateTime.now());
        asset.setGmtModified(LocalDateTime.now());
        asset.setVersion(0);
        asset.setIsDelete(false);
        assetMapper.insert(asset);

        // 3. output_asset_ids
        String outputAssetIdsJson = "[" + asset.getId() + "]";
        jobMapper.updateOutputAssetIds(jobIdLong, outputAssetIdsJson);

        // 4. log
        GenerationJobLogEntity logEntry = new GenerationJobLogEntity();
        logEntry.setGenerationJobId(jobIdLong);
        logEntry.setEvent("succeeded");
        logEntry.setStatus("succeeded");
        logEntry.setMessage("视频生成完成");
        logEntry.setPayload(toJson(Map.of("asset_ids", List.of(asset.getId().toString()))));
        logEntry.setOccurredAt(LocalDateTime.now());
        jobLogMapper.insert(logEntry);

        // 5. events
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

        // 6. 单槽语义（评审 I2：TS video-ops.ts:129-131 findFirst slot_index=0，不扩多槽）
        GenerationOutputSlotEntity videoSlot = slotMapper.findByJobId(jobIdLong).stream()
                .filter(s -> s.getSlotIndex() != null && s.getSlotIndex() == 0)
                .findFirst().orElse(null);
        if (videoSlot != null) {
            slotMapper.updateSlot(videoSlot.getId(), "succeeded", asset.getId());
            if (videoSlot.getSceneCardGenerationRecordId() != null) {
                syncRecordSummary(videoSlot.getSceneCardGenerationRecordId());
            }
        }
        // 评审 I1：TS 视频路径**不调** syncStoryboardPreviewSummary（仅 record summary）。

        // 7. output_attached 事件（video-ops.ts:175-194，评审补漏）
        if (job != null && job.getProjectId() != null) {
            appendProjectEvent(job.getProjectId(), "generation_job.output_attached",
                    "generation_job_output",
                    job.getId().toString() + ":" + (videoSlot != null ? videoSlot.getSlotIndex() : 0),
                    0,
                    "job_" + job.getId().toString(),
                    Map.of("job_id", job.getId().toString(),
                            "slot_id", videoSlot != null ? videoSlot.getId().toString() : "",
                            "slot_index", videoSlot != null ? videoSlot.getSlotIndex() : 0,
                            "status", "succeeded",
                            "asset_id", asset.getId().toString(),
                            "retry_of_slot_id", videoSlot != null && videoSlot.getRetryOfSlotId() != null
                                    ? videoSlot.getRetryOfSlotId().toString() : "",
                            "initial_placement_status", "pending"));
        }

        return true;
    }

    /**
     * 失败视频作业（video-ops.ts:200-303 failVideoJob 独立实现，评审修复）。
     * <p>
     * 与通用 failJob 的逐字差异：守卫多清 next_poll_at；pending 槽逐个标 failed 且
     * **每个带 record FK 的槽都回写 syncRecordSummary**（通用版仅 firstSlot）；
     * 不调 syncStoryboardPreviewSummary。release 段按修正一省略。
     */
    @Transactional
    public boolean failVideoJob(String jobId, String errorCode, String errorMessage,
                                Map<String, Object> details,
                                String workerId, long fencingToken) {
        Long jobIdLong = Long.parseLong(jobId);
        Map<String, Object> errorObj = new HashMap<>();
        errorObj.put("code", errorCode);
        errorObj.put("message", errorMessage);
        if (details != null) {
            errorObj.put("details", details);
        }
        int affected = jobMapper.failVideoGuard(jobIdLong, workerId, fencingToken, toJson(errorObj));
        if (affected != 1) {
            return false;
        }
        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        List<GenerationOutputSlotEntity> pendingSlots = slotMapper.findPendingByJobId(jobIdLong);
        for (GenerationOutputSlotEntity slot : pendingSlots) {
            slotMapper.updateSlotStatus(slot.getId(), "failed");
            if (slot.getSceneCardGenerationRecordId() != null) {
                syncRecordSummary(slot.getSceneCardGenerationRecordId());
            }
        }
        GenerationJobLogEntity logEntry = new GenerationJobLogEntity();
        logEntry.setGenerationJobId(jobIdLong);
        logEntry.setEvent("failed");
        logEntry.setStatus("failed");
        logEntry.setMessage(errorCode + ": " + errorMessage);
        logEntry.setOccurredAt(LocalDateTime.now());
        jobLogMapper.insert(logEntry);
        if (job != null && job.getProjectId() != null) {
            appendProjectEvent(job.getProjectId(), "generation_job.status_changed",
                    "generation_job", job.getId().toString(), job.getVersion(),
                    "job_" + job.getId().toString(),
                    Map.of("job_id", job.getId().toString(),
                            "type", job.getType(),
                            "source", job.getSource(),
                            "status", job.getStatus(),
                            "progress", job.getProgress(),
                            "error", Map.of("code", errorCode, "message", errorMessage)));
            for (GenerationOutputSlotEntity slot : pendingSlots) {
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
        return true;
    }

    /**
     * 取消视频作业（video-ops.ts:306-343 cancelVideoBeforeDispatch）。
     * <p>
     * WHERE provider_task_id IS NULL（未提交上游才可取消）。
     * SET status='cancelled', progress=0。
     * <p>
     * <b>修正一</b>：release refund_confirmed 段整体省略。
     */
    public boolean cancelVideoBeforeDispatch(String jobId, String workerId, long fencingToken) {
        Long jobIdLong = Long.parseLong(jobId);
        // 评审 I4：TS video-ops.ts:306-343 不写任何日志行——删除原多补的 cancelled log。
        return jobMapper.cancelVideoBeforeDispatch(jobIdLong, workerId, fencingToken) == 1;
    }
}
