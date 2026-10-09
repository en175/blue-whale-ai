package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.dto.ClaimedVideoJobDto;
import com.bluewhale.worker.domain.dto.UpdateMediaExtractProgressDto;
import com.bluewhale.worker.domain.entity.GenerationJobLogEntity;
import com.bluewhale.worker.domain.contract.JobStatusEnum;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.ProjectEventMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.SceneCardGenerationRecordMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobExtraMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.StoryboardPreviewMapper;
import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.Optional;

@Service
public class JobStateMachineService {

    private static final Logger log = LoggerFactory.getLogger(JobStateMachineService.class);

    private static final int LEASE_SECONDS = 120;

    private static final int VIDEO_SCENE_SPLIT_PROGRESS_LEASE_SECONDS = 420;

    private static final int VIDEO_MATTING_PROGRESS_LEASE_SECONDS = 420;

    private static final int PARENT_REUSE_SUBMIT_LEASE_SECONDS = 420;

    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();

    private final GenerationJobMapper jobMapper;
    private final GenerationJobLogMapper jobLogMapper;
    private final JobClaimService claimService;
    private final JobFinalizer finalizer;

    public JobStateMachineService(
            GenerationJobMapper jobMapper,
            AssetMapper assetMapper,
            GenerationJobLogMapper jobLogMapper,
            ProjectEventMapper projectEventMapper,
            GenerationOutputSlotMapper slotMapper,
            SceneCardGenerationRecordMapper sceneCardRecordMapper,
            StoryboardPreviewMapper storyboardPreviewMapper,
            GenerationJobExtraMapper extraMapper
    ) {
        this(jobMapper, jobLogMapper,
                new JobClaimService(jobMapper, extraMapper),
                new JobFinalizer(jobMapper, assetMapper, jobLogMapper, slotMapper, extraMapper,
                        new SceneCardGenerationRecordSync(slotMapper, sceneCardRecordMapper,
                                new ProjectEventPublisher(projectEventMapper)),
                        new StoryboardPreviewSync(slotMapper, storyboardPreviewMapper,
                                new ProjectEventPublisher(projectEventMapper)),
                        new ProjectEventPublisher(projectEventMapper),
                        JobSettlementPublisher.noop()));
    }

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

    public boolean cancelAudioMixIfRequested(String jobId, String workerId, long fencingToken) {
        return jobMapper.cancelAudioMixIfRequested(Long.parseLong(jobId), workerId, fencingToken) == 1;
    }

    public boolean cancelAudioVideoMuxIfRequested(String jobId, String workerId, long fencingToken) {
        return jobMapper.cancelAudioVideoMuxIfRequested(Long.parseLong(jobId), workerId, fencingToken) == 1;
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


    public String createAsset(CreateAssetInput input) {
        return finalizer.createAsset(
                input.userId(), input.projectId(), input.generationJobId(), input.type(),
                input.url(), input.storageKey(), input.mime(), input.size(), input.md5(),
                input.width(), input.height(), input.durationMs(),
                input.workerId(), input.fencingToken());
    }

    public record CreateAssetInput(
            String userId,
            String projectId,
            String generationJobId,
            String type,
            String url,
            String storageKey,
            String mime,
            Long size,
            String md5,
            Integer width,
            Integer height,
            Integer durationMs,
            String workerId,
            long fencingToken
    ) {}

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
        } else {
            finalizer.releaseHoldForCancelled(jobId);
        }
        return ok;
    }


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

    public boolean renewAudioVideoMuxLease(String jobId, String workerId, long fencingToken) {
        return jobMapper.renewAudioVideoMuxLease(Long.parseLong(jobId), workerId,
                fencingToken, WorkerClock.now().plusSeconds(420)) == 1;
    }

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

    public boolean markSubmissionAttempt(String jobId, String workerId, long fencingToken) {
        Long jobIdLong = Long.parseLong(jobId);
        int affected = jobMapper.markSubmissionAttempt(jobIdLong, workerId, fencingToken);
        if (affected != 1) {
            log.warn("[video] markSubmissionAttempt 守卫未命中(stale/租约失效/已提交) jobId={} workerId={} token={}，停止提交",
                    jobId, workerId, fencingToken);
        }
        return affected == 1;
    }

    public boolean reserveParentReuseSubmit(String jobId, String workerId, long fencingToken) {
        try {
            LocalDateTime leaseExpiresAt = WorkerClock.now()
                    .plusSeconds(PARENT_REUSE_SUBMIT_LEASE_SECONDS);
            boolean reserved = jobMapper.reserveParentReuseSubmit(
                    Long.parseLong(jobId), workerId, fencingToken, leaseExpiresAt) == 1;
            if (!reserved) {
                log.warn("[parent-reuse] 回退提交前执行权守卫未命中（owner/fence 已变或已提交），停止本次执行 jobId={}", jobId);
            }
            return reserved;
        } catch (Exception error) {
            log.warn("[parent-reuse] 回退提交前续租状态无法确认，停止本次执行 jobId={}: {}",
                    jobId, error.getMessage(), error);
            return false;
        }
    }

    public boolean rescheduleProviderPoll(String jobId, String workerId,
                                       long fencingToken, int progress) {
        return rescheduleProviderPoll(jobId, workerId, fencingToken, progress, 5_000L);
    }

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

    public boolean cancelVideoBeforeDispatch(String jobId, String workerId, long fencingToken) {
        Long jobIdLong = Long.parseLong(jobId);
        boolean ok = jobMapper.cancelVideoBeforeDispatch(jobIdLong, workerId, fencingToken) == 1;
        if (!ok) {
            log.warn("[video] cancelVideoBeforeDispatch 守卫未命中(stale/已提交上游) jobId={} workerId={} token={}",
                    jobId, workerId, fencingToken);
        } else {
            finalizer.releaseHoldForCancelled(jobId);
        }
        return ok;
    }


    static java.util.List<GenerationOutputSlotEntity> resolveLogicalSlots(
            java.util.List<GenerationOutputSlotEntity> slots) {
        return JobStatusEnum.resolveLogicalSlots(slots);
    }

    static String aggregateSlotStatus(java.util.List<GenerationOutputSlotEntity> resolvedSlots) {
        return JobStatusEnum.aggregateSlotStatus(resolvedSlots);
    }


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
