package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.dto.ClaimedImageCutoutJobDto;
import com.bluewhale.worker.domain.dto.ClaimedImageEnhanceJobDto;
import com.bluewhale.worker.domain.dto.ClaimedImageEraseJobDto;
import com.bluewhale.worker.domain.dto.ClaimedMediaExtractJobDto;
import com.bluewhale.worker.domain.dto.ClaimedVideoJobDto;
import com.bluewhale.worker.domain.dto.ClaimedVideoSubtitleEraseJobDto;
import com.bluewhale.worker.domain.dto.UpdateMediaExtractProgressDto;
import com.bluewhale.worker.domain.entity.GenerationJobLogEntity;
import com.bluewhale.worker.domain.contract.JobStatusEnum;
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

    /** video_scene_split 进度续租秒数（与 JobClaimService.VIDEO_SCENE_SPLIT_LEASE_SECONDS 同值）。 */
    private static final int VIDEO_SCENE_SPLIT_PROGRESS_LEASE_SECONDS = 420;

    /** video_matting 进度续租秒数（与 JobClaimService.VIDEO_MATTING_LEASE_SECONDS 同值）。 */
    private static final int VIDEO_MATTING_PROGRESS_LEASE_SECONDS = 420;

    /** 八个 MediaKit 家族原有的 420 秒租约，长于上游 submit 的 30 秒超时。 */
    private static final int PARENT_REUSE_SUBMIT_LEASE_SECONDS = 420;

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

    /** 以 audio_mix 类型和 dock 来源筛选候选；委托统一的轮询音频 CAS 领取，未命中返回空。 */
    public Optional<ClaimedMediaExtractJobDto> claimAudioMix(String jobId, String workerId) {
        return claimService.claimAudioMix(jobId, workerId);
    }

    public Optional<com.bluewhale.worker.domain.dto.ClaimedAudioTrimJobDto> claimAudioTrim(
            String jobId, String workerId) {
        return claimService.claimAudioTrim(jobId, workerId);
    }

    public Optional<com.bluewhale.worker.domain.dto.ClaimedAudioSpeedJobDto> claimAudioSpeed(
            String jobId, String workerId) {
        return claimService.claimAudioSpeed(jobId, workerId);
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

    public Optional<ClaimedImageEraseJobDto> claimImageErase(String jobId, String workerId) {
        return claimService.claimImageErase(jobId, workerId);
    }

    public Optional<ClaimedImageCutoutJobDto> claimImageCutout(String jobId, String workerId) {
        return claimService.claimImageCutout(jobId, workerId);
    }

    public Optional<com.bluewhale.worker.domain.dto.ClaimedImageOutpaintJobDto> claimImageOutpaint(
            String jobId, String workerId) {
        return claimService.claimImageOutpaint(jobId, workerId);
    }

    public Optional<ClaimedVideoSubtitleEraseJobDto> claimVideoSubtitleErase(String jobId, String workerId) {
        return claimService.claimVideoSubtitleErase(jobId, workerId);
    }

    public Optional<com.bluewhale.worker.domain.dto.ClaimedVideoEnhanceJobDto> claimVideoEnhance(
            String jobId, String workerId) {
        return claimService.claimVideoEnhance(jobId, workerId);
    }

    public Optional<com.bluewhale.worker.domain.dto.ClaimedVocalSplitJobDto> claimVocalSplit(
            String jobId, String workerId) {
        return claimService.claimVocalSplit(jobId, workerId);
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
            String url, String storageKey, String mime, Long size, String md5, Double duration
    ) {
        return finalizer.publishMediaExtractResult(
                jobId, projectId, userId, workerId, fencingToken, url, storageKey, mime, size, md5, duration);
    }

    public boolean publishVideoResult(String jobId, String projectId, String userId,
                                      String workerId, long fencingToken,
                                      String url, String storageKey, String mime, Long size, String md5,
                                      Integer width, Integer height, double duration) {
        return finalizer.publishVideoResult(
                jobId, projectId, userId, workerId, fencingToken,
                url, storageKey, mime, size, md5, width, height, duration);
    }

    public boolean failVideoJob(String jobId, String errorCode, String errorMessage,
                                Map<String, Object> details, String workerId, long fencingToken) {
        return finalizer.failVideoJob(jobId, errorCode, errorMessage, details, workerId, fencingToken);
    }

    public String createAsset(CreateAssetInput input) {
        return finalizer.createAsset(
                input.userId(), input.projectId(), input.generationJobId(), input.type(),
                input.url(), input.storageKey(), input.mime(), input.size(), input.md5(),
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
            /** IKGS73：产物字节的 md5（32 位小写 hex），落 assets.md5 供去重。 */
            String md5,
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
                input.url(), input.storageKey(), input.mime(), input.size(), input.md5(), input.duration());
    }

    /** 委托音频混合终态事务；仅当前租约与 fencing token 有效时创建长期 Asset 并成功，失效返回 false。 */
    public boolean publishAudioMixResult(com.bluewhale.worker.domain.dto.PublishMediaExtractDto input) {
        return finalizer.publishAudioMixResult(input);
    }

    public boolean failMediaExtractJob(com.bluewhale.worker.domain.dto.FailMediaExtractDto input) {
        return finalizer.failMediaExtractJob(
                input.jobId(), input.code(), input.message(), input.details(),
                input.workerId(), input.fencingToken());
    }

    // ========== audio_trim 直通（DTO 形态，AudioTrimJobProcessor 专用，IKHB6S） ==========

    public boolean publishAudioTrimResult(com.bluewhale.worker.domain.dto.PublishAudioTrimDto input) {
        return finalizer.publishAudioTrimResult(input);
    }

    public boolean failAudioTrimJob(com.bluewhale.worker.domain.dto.FailAudioTrimDto input) {
        return finalizer.failAudioTrimJob(input);
    }

    // ========== audio_speed 直通（DTO 形态，AudioSpeedJobProcessor 专用，IKHW5A） ==========

    public boolean publishAudioSpeedResult(com.bluewhale.worker.domain.dto.PublishAudioSpeedDto input) {
        return finalizer.publishAudioSpeedResult(input);
    }

    public boolean failAudioSpeedJob(com.bluewhale.worker.domain.dto.FailAudioSpeedDto input) {
        return finalizer.failAudioSpeedJob(input);
    }

    // ========== image_enhance 直通（DTO 形态，ImageEnhanceJobProcessor 专用；失败复用通用 failJob） ==========

    public boolean publishImageEnhanceResult(com.bluewhale.worker.domain.dto.PublishImageEnhanceDto input) {
        return finalizer.publishImageEnhanceResult(input);
    }

    // ========== image_erase 直通（DTO 形态，ImageEraseJobProcessor 专用；失败复用通用 failJob） ==========

    public boolean publishImageEraseResult(com.bluewhale.worker.domain.dto.PublishImageEraseDto input) {
        return finalizer.publishImageEraseResult(input);
    }

    // ========== image_cutout 直通（DTO 形态，ImageCutoutJobProcessor 专用；失败复用通用 failJob） ===
    public boolean publishImageCutoutResult(com.bluewhale.worker.domain.dto.PublishImageCutoutDto input) {
        return finalizer.publishImageCutoutResult(input);
    }

    // ========== image_outpaint 直通（DTO 形态，ImageOutpaintJobProcessor 专用；失败复用通用 failJob） ==========

    public boolean publishImageOutpaintResult(
            com.bluewhale.worker.domain.dto.PublishImageOutpaintDto input) {
        return finalizer.publishImageOutpaintResult(input);
    }

    // ========== video_subtitle_erase 直通（DTO 形态，VideoSubtitleEraseJobProcessor 专用；
    //            失败复用视频版 failVideoJob——轮询型任务守卫多清 next_poll_at） ==========

    public boolean publishVideoSubtitleEraseResult(
            com.bluewhale.worker.domain.dto.PublishVideoSubtitleEraseDto input) {
        return finalizer.publishVideoSubtitleEraseResult(input);
    }

    // ========== video_enhance 直通（DTO 形态，VideoEnhanceJobProcessor 专用；
    //            失败复用视频版 failVideoJob——轮询型任务守卫多清 next_poll_at） ==========

    public boolean publishVideoEnhanceResult(
            com.bluewhale.worker.domain.dto.PublishVideoEnhanceDto input) {
        return finalizer.publishVideoEnhanceResult(input);
    }

    // ========== vocal_split 直通（DTO 形态，VocalSplitJobProcessor 专用；
    //            失败复用 failMediaExtractJob 守卫——轮询型任务守卫多清 next_poll_at，
    //            跨工具复用同款 SQL，video_enhance 复用 failVideoJob 同例） ==========

    public boolean publishVocalSplitResult(
            com.bluewhale.worker.domain.dto.PublishVocalSplitDto input) {
        return finalizer.publishVocalSplitResult(input);
    }

    public boolean failVocalSplitJob(com.bluewhale.worker.domain.dto.FailMediaExtractDto input) {
        return finalizer.failMediaExtractJob(
                input.jobId(), input.code(), input.message(), input.details(),
                input.workerId(), input.fencingToken());
    }

    // ========== video_scene_split 直通（DTO 形态，VideoSceneSplitJobProcessor 专用；
    //            失败复用视频版 failVideoJob——轮询型任务守卫多清 next_poll_at） ==========

    public Optional<com.bluewhale.worker.domain.dto.ClaimedVideoSceneSplitJobDto> claimVideoSceneSplit(
            String jobId, String workerId) {
        return claimService.claimVideoSceneSplit(jobId, workerId);
    }

    public boolean publishVideoSceneSplitResult(
            com.bluewhale.worker.domain.dto.PublishVideoSceneSplitDto input) {
        return finalizer.publishVideoSceneSplitResult(input);
    }

    // ========== video_matting 直通（DTO 形态，VideoMattingJobProcessor 专用；
    //            失败复用视频版 failVideoJob——轮询型任务守卫多清 next_poll_at） ==========

    public Optional<com.bluewhale.worker.domain.dto.ClaimedVideoMattingJobDto> claimVideoMatting(
            String jobId, String workerId) {
        return claimService.claimVideoMatting(jobId, workerId);
    }

    public boolean publishVideoMattingResult(
            com.bluewhale.worker.domain.dto.PublishVideoMattingDto input) {
        return finalizer.publishVideoMattingResult(input);
    }

    // ========== video_frame_interpolation 直通（DTO 形态，VideoFrameInterpolationJobProcessor
    //            专用，IKHLKJ；失败复用视频版 failVideoJob——轮询型任务守卫多清 next_poll_at） ==========

    public Optional<com.bluewhale.worker.domain.dto.ClaimedVideoFrameInterpolationJobDto>
            claimVideoFrameInterpolation(String jobId, String workerId) {
        return claimService.claimVideoFrameInterpolation(jobId, workerId);
    }

    public boolean publishVideoFrameInterpolationResult(
            com.bluewhale.worker.domain.dto.PublishVideoFrameInterpolationDto input) {
        return finalizer.publishVideoFrameInterpolationResult(input);
    }

    /**
     * 取消 video_frame_interpolation 作业（IKHLKJ；CAS 与
     * {@link #cancelVideoBeforeDispatch} 同款，按是否已提交上游分派到两条 SQL）。
     * <p>
     * providerTaskId == null（未提交上游）→ {@code cancelVideoBeforeDispatch}（家族既有件，
     * 带 {@code provider_task_id IS NULL} 限定）；已提交 → {@code cancelVideoAfterDispatch}
     * （官方无取消端点，上游任务不可撤，本仓侧停止接纳其结果）。两条 SQL 都只允许
     * status='processing' + 当前 lease_owner + 当前 fencing_token 命中，故已到终态的任务
     * 不会被取消改写，取消也抢不过先生效的终态（fencing/终态权威）。
     */
    public boolean cancelVideoFrameInterpolation(String jobId, String workerId,
                                                 long fencingToken, String providerTaskId) {
        Long jobIdLong = Long.parseLong(jobId);
        int affected = providerTaskId == null
                ? jobMapper.cancelVideoBeforeDispatch(jobIdLong, workerId, fencingToken)
                : jobMapper.cancelVideoAfterDispatch(jobIdLong, workerId, fencingToken);
        boolean ok = affected == 1;
        if (!ok) {
            log.warn("[video_frame_interpolation] cancel 守卫未命中(stale/已终态) jobId={} workerId={} token={}",
                    jobId, workerId, fencingToken);
        }
        return ok;
    }

    // ========== 心跳 / 重排（DB 紧耦合，保留本类） ==========

    /**
     * 更新 media_extract 进度（media-extract-ops.ts:26-43）：0-99 钳制 + 续租。
     */
    public boolean updateMediaExtractProgress(UpdateMediaExtractProgressDto input) {
        Long jobIdLong = Long.parseLong(input.jobId());
        int clampedProgress = Math.max(0, Math.min(99, Math.round((float) input.progress())));
        LocalDateTime leaseExpiresAt = WorkerClock.now().plusSeconds(LEASE_SECONDS);
        int affected = jobMapper.updateMediaExtractProgress(
                jobIdLong, input.workerId(), input.fencingToken(),
                clampedProgress, leaseExpiresAt);
        return affected == 1;
    }

    public boolean renewAudioMixLease(String jobId, String workerId, long fencingToken) {
        return jobMapper.renewAudioMixLease(Long.parseLong(jobId), workerId,
                fencingToken, WorkerClock.now().plusSeconds(420)) == 1;
    }

    /**
     * 更新 video_scene_split 进度（IKH8BP 审查修复；属本类保留的 progress 续租族）：
     * 0-99 钳制 + 续租。
     * <p>
     * completed 相逐段下载转存是长窗口（N 段串行，单段可达源视频体量），claim 时的
     * 420s 租约覆盖不了全程——每段转存前调本方法把租约推回 now+420s，否则 recovery
     * 会在租约过期后判孤儿重投，新 claim 从头重新下载全部段（每轮重复带宽消耗）；
     * 创建后 120 分钟重投窗口（RECOVERY_MAX_AGE_MINUTES）耗尽后任务静默卡 processing。
     * 续租秒数与 JobClaimService.VIDEO_SCENE_SPLIT_LEASE_SECONDS 同值（单段转存窗口），
     * 不复用 LEASE_SECONDS(120s)——大段下载+TOS 上传可超 120s，段中途即会过期。
     */
    public boolean updateVideoSceneSplitProgress(
            com.bluewhale.worker.domain.dto.UpdateVideoSceneSplitProgressDto input) {
        Long jobIdLong = Long.parseLong(input.jobId());
        int clampedProgress = Math.max(0, Math.min(99, Math.round((float) input.progress())));
        LocalDateTime leaseExpiresAt = WorkerClock.now()
                .plusSeconds(VIDEO_SCENE_SPLIT_PROGRESS_LEASE_SECONDS);
        int affected = jobMapper.updateVideoSceneSplitProgress(
                jobIdLong, input.workerId(), input.fencingToken(),
                clampedProgress, leaseExpiresAt);
        return affected == 1;
    }

    /**
     * 更新 video_matting 进度（IKHK99；updateVideoSceneSplitProgress 的单产物形态）：
     * 0-99 钳制 + 续租。
     * <p>
     * completed 相单产物下载转存是长窗口（输入可达 10GB 级），claim 时的 420s 租约可能
     * 覆盖不了全程——转存前调本方法把租约推回 now+420s（progress 沿用 claim 快照不倒退），
     * 否则 recovery 会在租约过期后判孤儿重投，新 claim 重复下载同一产物；创建后 120 分钟
     * 重投窗口（RECOVERY_MAX_AGE_MINUTES）耗尽后任务静默卡 processing。
     */
    public boolean updateVideoMattingProgress(
            com.bluewhale.worker.domain.dto.UpdateVideoMattingProgressDto input) {
        Long jobIdLong = Long.parseLong(input.jobId());
        int clampedProgress = Math.max(0, Math.min(99, Math.round((float) input.progress())));
        LocalDateTime leaseExpiresAt = WorkerClock.now()
                .plusSeconds(VIDEO_MATTING_PROGRESS_LEASE_SECONDS);
        int affected = jobMapper.updateVideoMattingProgress(
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
     * 标记生成任务已提交（generation-worker-video-ops.ts 对应实现）：provider_task_id + 释放租约 + next+5s。
     */
    public boolean markProviderSubmitted(String jobId, String workerId,
                                      long fencingToken, String providerTaskId) {
        Long jobIdLong = Long.parseLong(jobId);
        LocalDateTime nextPollAt = WorkerClock.now().plusNanos(5_000L * 1_000_000);
        int affected = jobMapper.markProviderSubmitted(jobIdLong, workerId, fencingToken, providerTaskId, nextPollAt);
        if (affected != 1) {
            log.warn("[video] markProviderSubmitted 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    jobId, workerId, fencingToken);
        }
        return affected == 1;
    }

    /** 仅在重试收割回退提交前续租；无法确认执行权时禁止产生新的上游任务。 */
    public boolean reserveParentReuseSubmit(String jobId, String workerId, long fencingToken) {
        try {
            LocalDateTime leaseExpiresAt = WorkerClock.now()
                    .plusSeconds(PARENT_REUSE_SUBMIT_LEASE_SECONDS);
            boolean reserved = jobMapper.reserveParentReuseSubmit(
                    Long.parseLong(jobId), workerId, fencingToken, leaseExpiresAt) == 1;
            if (!reserved) {
                log.warn("[parent-reuse] 回退提交前租约守卫未命中，停止本次执行 jobId={}", jobId);
            }
            return reserved;
        } catch (Exception error) {
            log.warn("[parent-reuse] 回退提交前续租状态无法确认，停止本次执行 jobId={}: {}",
                    jobId, error.getMessage(), error);
            return false;
        }
    }

    /**
     * 重排生成任务轮询（generation-worker-video-ops.ts 对应实现）：poll_count+1 + 钳制 + 释放租约 + next+5s。
     */
    public boolean rescheduleProviderPoll(String jobId, String workerId,
                                       long fencingToken, int progress) {
        return rescheduleProviderPoll(jobId, workerId, fencingToken, progress, 5_000L);
    }

    /** audio_mix 轮询退避的持久时刻须与 MQ 延迟相同；普通任务仍调用固定 5s 入口。 */
    public boolean rescheduleProviderPoll(String jobId, String workerId,
                                       long fencingToken, int progress, long delayMs) {
        Long jobIdLong = Long.parseLong(jobId);
        int clamped = Math.max(0, Math.min(99, progress));
        LocalDateTime now = WorkerClock.now();
        LocalDateTime nextPollAt = now.plusNanos(delayMs * 1_000_000);
        int affected = jobMapper.rescheduleProviderPoll(jobIdLong, workerId, fencingToken, clamped, now, nextPollAt);
        if (affected != 1) {
            log.warn("[video] rescheduleProviderPoll 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
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
        return JobStatusEnum.resolveLogicalSlots(slots);
    }

    static String aggregateSlotStatus(java.util.List<GenerationOutputSlotEntity> resolvedSlots) {
        return JobStatusEnum.aggregateSlotStatus(resolvedSlots);
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
        logEntry.setOccurredAt(WorkerClock.now());
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
