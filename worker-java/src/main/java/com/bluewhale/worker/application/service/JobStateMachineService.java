package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.dto.ClaimedImageEnhanceJobDto;
import com.bluewhale.worker.domain.dto.ClaimedMediaExtractJobDto;
import com.bluewhale.worker.domain.dto.ClaimedVideoJobDto;
import com.bluewhale.worker.domain.dto.UpdateMediaExtractProgressDto;
import com.bluewhale.worker.domain.entity.GenerationJobLogEntity;
import com.bluewhale.worker.domain.entity.JobStatus;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.mapper.ProjectEventMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.mapper.SceneCardGenerationRecordMapper;
import com.bluewhale.worker.infrastructure.mapper.StoryboardPreviewMapper;
import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 生成作业状态机门面（刀④：1210 行 god-service 拆分后保留的薄壳）。
 * <p>
 * 职责已拆往：{@link JobClaimService}（claim 族）、{@link JobFinalizer}（complete/fail/publish/
 * createAsset 终态收口）、{@link ProjectEventPublisher}（事件）、{@link SceneCardGenerationRecordSync}/
 * {@link StoryboardPreviewSync}（摘要同步）。本类保留公共 API 签名不变（processor/测试零改动），
 * 只留与 DB 心跳/轮询紧耦合的薄方法（progress 续租、requeue、markSubmitted、reschedule、cancel）。
 * <p>
 * 第 5 类媒体扩展触点：{@link JobClaimService} 加 claim*、{@link JobFinalizer} 加 payload 组装策略
 * （契约附录 C），本门面不加方法。
 */
@Service
public class JobStateMachineService {

    private static final Logger log = LoggerFactory.getLogger(JobStateMachineService.class);

    private static final int LEASE_SECONDS = 120; // 契约 §3.2：IMAGE_JOB_LEASE_SECONDS 默认 120s

    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();

    private final GenerationJobMapper jobMapper;
    private final GenerationJobLogMapper jobLogMapper;
    private final JobClaimService claimService;
    private final JobFinalizer finalizer;

    /**
     * 兼容旧 7-mapper 构造（测试直连）：内部组装拆分后的组件。
     * <p>
     * 生产装配走 Spring 构造注入（4-arg 构造 + 各组件 @Service）；
     * 本 7-mapper 构造保留给 test 直连（Mockito / Testcontainers 手动装配）。
     */
    public JobStateMachineService(
            GenerationJobMapper jobMapper,
            AssetMapper assetMapper,
            GenerationJobLogMapper jobLogMapper,
            ProjectEventMapper projectEventMapper,
            GenerationOutputSlotMapper slotMapper,
            SceneCardGenerationRecordMapper sceneCardRecordMapper,
            StoryboardPreviewMapper storyboardPreviewMapper
    ) {
        this(jobMapper, jobLogMapper,
                new JobClaimService(jobMapper),
                new JobFinalizer(jobMapper, assetMapper, jobLogMapper, slotMapper,
                        new SceneCardGenerationRecordSync(slotMapper, sceneCardRecordMapper,
                                new ProjectEventPublisher(projectEventMapper)),
                        new StoryboardPreviewSync(slotMapper, storyboardPreviewMapper,
                                new ProjectEventPublisher(projectEventMapper)),
                        new ProjectEventPublisher(projectEventMapper)));
    }

    /**
     * 生产装配构造（Spring 构造注入）：拆分组件的门面组合。
     * <p>
     * 存在 7-mapper 测试直连构造 → 必须显式 {@code @Autowired} 钉住本构造，
     * 否则 Spring 因多构造器退回找无参构造（No default constructor）。
     */
    @Autowired
    public JobStateMachineService(
            GenerationJobMapper jobMapper,
            GenerationJobLogMapper jobLogMapper,
            JobClaimService claimService,
            JobFinalizer finalizer
    ) {
        this.jobMapper = jobMapper;
        this.jobLogMapper = jobLogMapper;
        this.claimService = claimService;
        this.finalizer = finalizer;
    }

    // ========== claim 族（委托 JobClaimService） ==========

    public Optional<ClaimedMediaExtractJobDto> claimMediaExtract(String jobId, String workerId) {
        return claimService.claimMediaExtract(jobId, workerId);
    }

    public Optional<ClaimedJobDto> claimAudioJobById(String jobId, String workerId) {
        return claimService.claimAudioJobById(jobId, workerId);
    }

    public Optional<ClaimedJobDto> claimImageJobById(String jobId, String workerId) {
        return claimService.claimImageJobById(jobId, workerId);
    }

    public Optional<ClaimedVideoJobDto> claimVideoJobById(String jobId, String workerId) {
        return claimService.claimVideoJobById(jobId, workerId);
    }

    public Optional<ClaimedImageEnhanceJobDto> claimImageEnhance(String jobId, String workerId) {
        return claimService.claimImageEnhance(jobId, workerId);
    }

    public Optional<com.bluewhale.worker.domain.dto.ClaimedImageOutpaintJobDto> claimImageOutpaint(
            String jobId, String workerId) {
        return claimService.claimImageOutpaint(jobId, workerId);
    }

    // ========== 终态收口（委托 JobFinalizer） ==========

    public boolean completeJob(String jobId, List<String> assetIds, String workerId, long fencingToken) {
        return finalizer.completeJob(jobId, assetIds, workerId, fencingToken);
    }

    public boolean failJob(String jobId, String errorCode, String errorMessage,
                           Map<String, Object> details, String workerId, long fencingToken) {
        return finalizer.failJob(jobId, errorCode, errorMessage, details, workerId, fencingToken);
    }

    public boolean publishMediaExtractResult(
            String jobId, String projectId, String userId, String workerId, long fencingToken,
            String url, String storageKey, String mime, Long size, Double duration
    ) {
        return finalizer.publishMediaExtractResult(
                jobId, projectId, userId, workerId, fencingToken, url, storageKey, mime, size, duration);
    }

    public boolean publishVideoResult(String jobId, String projectId, String userId,
                                      String workerId, long fencingToken,
                                      String url, String storageKey, String mime, Long size,
                                      Integer width, Integer height, double duration) {
        return finalizer.publishVideoResult(
                jobId, projectId, userId, workerId, fencingToken,
                url, storageKey, mime, size, width, height, duration);
    }

    public boolean failVideoJob(String jobId, String errorCode, String errorMessage,
                                Map<String, Object> details, String workerId, long fencingToken) {
        return finalizer.failVideoJob(jobId, errorCode, errorMessage, details, workerId, fencingToken);
    }

    public String createAsset(CreateAssetInput input) {
        return finalizer.createAsset(
                input.userId(), input.projectId(), input.generationJobId(), input.type(),
                input.url(), input.storageKey(), input.mime(), input.size(),
                input.width(), input.height(), input.durationMs(),
                input.workerId(), input.fencingToken());
    }

    /** createAsset 输入（对齐 TS WorkerRepo.createAsset 参数，asset-ops.ts:151-202）。 */
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
            Integer durationMs,
            String workerId,
            long fencingToken
    ) {}

    // ========== media_extract 直通（DTO 形态，MediaExtractJobProcessor 专用） ==========

    public boolean publishMediaExtractResult(com.bluewhale.worker.domain.dto.PublishMediaExtractDto input) {
        return finalizer.publishMediaExtractResult(
                input.jobId(), input.projectId(), input.userId(), input.workerId(), input.fencingToken(),
                input.url(), input.storageKey(), input.mime(), input.size(), input.duration());
    }

    public boolean failMediaExtractJob(com.bluewhale.worker.domain.dto.FailMediaExtractDto input) {
        return finalizer.failMediaExtractJob(
                input.jobId(), input.code(), input.message(), input.details(),
                input.workerId(), input.fencingToken());
    }

    // ========== image_enhance 直通（DTO 形态，ImageEnhanceJobProcessor 专用；失败复用通用 failJob） ==========

    public boolean publishImageEnhanceResult(com.bluewhale.worker.domain.dto.PublishImageEnhanceDto input) {
        return finalizer.publishImageEnhanceResult(input);
    }

    // ========== image_outpaint 直通（DTO 形态，ImageOutpaintJobProcessor 专用；失败复用通用 failJob） ==========

    public boolean publishImageOutpaintResult(
            com.bluewhale.worker.domain.dto.PublishImageOutpaintDto input) {
        return finalizer.publishImageOutpaintResult(input);
    }

    // ========== 心跳 / 重排（DB 紧耦合，保留本类） ==========

    /**
     * 更新 media_extract 进度（media-extract-ops.ts:26-43）：0-99 钳制 + 续租。
     */
    public boolean updateMediaExtractProgress(UpdateMediaExtractProgressDto input) {
        Long jobIdLong = Long.parseLong(input.jobId());
        int clampedProgress = Math.max(0, Math.min(99, Math.round((float) input.progress())));
        LocalDateTime leaseExpiresAt = LocalDateTime.now(ZoneOffset.UTC).plusSeconds(LEASE_SECONDS);
        int affected = jobMapper.updateMediaExtractProgress(
                jobIdLong, input.workerId(), input.fencingToken(),
                clampedProgress, leaseExpiresAt);
        return affected == 1;
    }

    /**
     * 瞬态重试：图片作业回 queued（claim-ops.ts:561-578 requeueImageJobForRetry）。
     * 无 fence 入参（契约附录 B 注）；DB 异常 → false（不抛）。
     */
    public boolean requeueImageJobForRetry(String jobId, LocalDateTime nextActionAt) {
        Long jobIdLong = Long.parseLong(jobId);
        try {
            int affected = jobMapper.requeueImageCas(jobIdLong, nextActionAt);
            return affected > 0;
        } catch (Exception e) {
            log.warn("[image] requeueImageJobForRetry DB 异常 jobId={}: {}", jobId, e.getMessage(), e);
            return false;
        }
    }

    /**
     * 标记视频已提交（video-ops.ts:14-30）：provider_task_id + 释放租约 + next+5s。
     */
    public boolean markVideoSubmitted(String jobId, String workerId,
                                      long fencingToken, String providerTaskId) {
        Long jobIdLong = Long.parseLong(jobId);
        LocalDateTime nextPollAt = LocalDateTime.now(ZoneOffset.UTC).plusNanos(5_000L * 1_000_000);
        int affected = jobMapper.markVideoSubmitted(jobIdLong, workerId, fencingToken, providerTaskId, nextPollAt);
        if (affected != 1) {
            log.warn("[video] markVideoSubmitted 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    jobId, workerId, fencingToken);
        }
        return affected == 1;
    }

    /**
     * 重排视频轮询（video-ops.ts:32-57）：poll_count+1 + 钳制 + 释放租约 + next+5s。
     */
    public boolean rescheduleVideoPoll(String jobId, String workerId,
                                       long fencingToken, int progress) {
        Long jobIdLong = Long.parseLong(jobId);
        int clamped = Math.max(0, Math.min(99, progress));
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);
        LocalDateTime nextPollAt = now.plusNanos(5_000L * 1_000_000);
        int affected = jobMapper.rescheduleVideoPoll(jobIdLong, workerId, fencingToken, clamped, now, nextPollAt);
        if (affected != 1) {
            log.warn("[video] rescheduleVideoPoll 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    jobId, workerId, fencingToken);
        }
        return affected == 1;
    }

    /**
     * 取消视频作业（video-ops.ts:306-343 cancelVideoBeforeDispatch）。
     * WHERE provider_task_id IS NULL；SET status='cancelled', progress=0。
     */
    public boolean cancelVideoBeforeDispatch(String jobId, String workerId, long fencingToken) {
        Long jobIdLong = Long.parseLong(jobId);
        boolean ok = jobMapper.cancelVideoBeforeDispatch(jobIdLong, workerId, fencingToken) == 1;
        if (!ok) {
            log.warn("[video] cancelVideoBeforeDispatch 守卫未命中(stale/已提交上游) jobId={} workerId={} token={}",
                    jobId, workerId, fencingToken);
        }
        return ok;
    }

    // ========== 槽位聚合工具（门面静态委托保签名；实现已迁 JobStatus） ==========
    // 可见性沿用原版（包私有 static）——金标测试在同包，无需放宽为 public。

    static java.util.List<GenerationOutputSlotEntity> resolveLogicalSlots(
            java.util.List<GenerationOutputSlotEntity> slots) {
        return com.bluewhale.worker.domain.entity.JobStatus.resolveLogicalSlots(slots);
    }

    static String aggregateSlotStatus(java.util.List<GenerationOutputSlotEntity> resolvedSlots) {
        return com.bluewhale.worker.domain.entity.JobStatus.aggregateSlotStatus(resolvedSlots);
    }

    // ========== 日志 ==========

    /**
     * 追加执行日志（各 processor 共用）。
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
        logEntry.setOccurredAt(LocalDateTime.now(ZoneOffset.UTC));
        jobLogMapper.insert(logEntry);
    }

    private String toJson(Object obj) {
        try {
            return JSON_MAPPER.writeValueAsString(obj);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize to JSON", e);
        }
    }
}
