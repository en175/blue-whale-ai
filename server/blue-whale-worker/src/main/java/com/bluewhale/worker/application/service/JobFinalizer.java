package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.domain.entity.GenerationJobLogEntity;
import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;
import com.bluewhale.worker.domain.contract.JobStatusEnum;
import com.bluewhale.worker.domain.dto.PublishImageCutoutDto;
import com.bluewhale.worker.domain.dto.PublishImageEnhanceDto;
import com.bluewhale.worker.domain.dto.PublishImageEraseDto;
import com.bluewhale.worker.infrastructure.persistence.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.domain.entity.GenerationJobExtraEntity;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobExtraMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationOutputSlotMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Service
public class JobFinalizer {

    private static final Logger log = LoggerFactory.getLogger(JobFinalizer.class);

    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();

    private final GenerationJobMapper jobMapper;
    private final AssetMapper assetMapper;
    private final GenerationJobLogMapper jobLogMapper;
    private final GenerationOutputSlotMapper slotMapper;

    private final GenerationJobExtraMapper extraMapper;
    private final SceneCardGenerationRecordSync recordSync;
    private final StoryboardPreviewSync previewSync;
    private final ProjectEventPublisher eventPublisher;
    private final JobSettlementPublisher settlementPublisher;

    public JobFinalizer(
            GenerationJobMapper jobMapper,
            AssetMapper assetMapper,
            GenerationJobLogMapper jobLogMapper,
            GenerationOutputSlotMapper slotMapper,
            GenerationJobExtraMapper extraMapper,
            SceneCardGenerationRecordSync recordSync,
            StoryboardPreviewSync previewSync,
            ProjectEventPublisher eventPublisher,
            JobSettlementPublisher settlementPublisher
    ) {
        this.jobMapper = jobMapper;
        this.assetMapper = assetMapper;
        this.jobLogMapper = jobLogMapper;
        this.slotMapper = slotMapper;
        this.extraMapper = extraMapper;
        this.recordSync = recordSync;
        this.previewSync = previewSync;
        this.eventPublisher = eventPublisher;
        this.settlementPublisher = settlementPublisher;
    }

    @Transactional
    public boolean publishMediaExtractResult(
            String jobId, String projectId, String userId, String workerId, long fencingToken,
            String url, String storageKey, String mime, Long size, String md5, Double duration
    ) {
        return publishSingleAssetResult(new SingleAssetPublish(
                "[media_extract] publishMediaExtractResult",
                jobId, projectId, userId, workerId, fencingToken, "audio",
                url, storageKey, mime, size, md5, null, null,
                duration != null ? (int) Math.round(duration * 1000) : null,
                "音频已提取", null));
    }

    @Transactional
    public boolean publishAudioMixResult(com.bluewhale.worker.domain.dto.PublishMediaExtractDto input) {
        return publishSingleAssetResult(new SingleAssetPublish(
                "[audio_mix] publishAudioMixResult",
                input.jobId(), input.projectId(), input.userId(), input.workerId(),
                input.fencingToken(), "audio", input.url(), input.storageKey(), input.mime(),
                input.size(), input.md5(), null, null,
                input.duration() != null ? (int) Math.round(input.duration() * 1000) : null,
                "音频混合完成", null));
    }

    @Transactional
    public boolean publishAudioVideoMuxResult(com.bluewhale.worker.domain.dto.PublishAudioVideoMuxDto input) {
        AssetEntity source = assetMapper.selectById(Long.parseLong(input.sourceVideoAssetId()));
        Integer width = null;
        Integer height = null;
        if (input.resolution() != null) {
            java.util.regex.Matcher matcher =
                    java.util.regex.Pattern.compile("^(\\d+)[xX](\\d+)$").matcher(input.resolution().trim());
            if (matcher.matches()) {
                width = Integer.valueOf(matcher.group(1));
                height = Integer.valueOf(matcher.group(2));
            }
        }
        if (width == null || height == null) {
            width = source != null ? source.getWidth() : null;
            height = source != null ? source.getHeight() : null;
        }
        Integer durationMs = input.durationSec() != null && Double.isFinite(input.durationSec())
                ? (int) Math.round(input.durationSec() * 1000)
                : (source != null ? source.getDurationMs() : null);
        Map<String, Object> extra = new java.util.HashMap<>();
        if (input.resolution() != null) extra.put("resolution", input.resolution());
        return publishSingleAssetResult(new SingleAssetPublish(
                "[audio_video_mux] publishAudioVideoMuxResult",
                input.jobId(), input.projectId(), input.userId(), input.workerId(),
                input.fencingToken(), "video", input.url(), input.storageKey(), input.mime(),
                input.size(), input.md5(), width, height, durationMs,
                "音视频合成完成", extra.isEmpty() ? null : extra,
                composeAudioVideoMuxResultName(source != null ? source.getName() : null)));
    }

    private static String composeAudioVideoMuxResultName(String sourceName) {
        String base = sourceName == null ? "" : sourceName.trim();
        int dot = base.lastIndexOf('.');
        if (dot > 0) base = base.substring(0, dot);
        if (base.isEmpty()) base = "视频";
        return base + "(音视频合成).mp4";
    }

    public boolean hasPublishedAsset(String jobId, String storageKey) {
        Long jobIdLong = Long.parseLong(jobId);
        Long assetId = assetMapper.findReferencingAssetId(jobIdLong, storageKey);
        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        log.info("[job-finalizer] 转存对象权威状态核实 jobId={} storageKey={} referencedAssetId={} jobType={} jobStatus={}",
                jobId, storageKey, assetId,
                job != null ? job.getType() : null, job != null ? job.getStatus() : null);
        return assetId != null;
    }

    public boolean hasInFlightJobWriteTransaction(String jobId) {
        try {
            jobMapper.probeJobRowWriteLock(Long.parseLong(jobId));
            return false;
        } catch (RuntimeException error) {
            if (isRowLockConflict(error)) return true;
            throw error;
        }
    }

    private static boolean isRowLockConflict(Throwable error) {
        for (Throwable t = error; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof java.sql.SQLException sql
                    && (sql.getErrorCode() == 3572 || sql.getErrorCode() == 1205)) {
                return true;
            }
        }
        return false;
    }


    @Transactional
    public boolean publishAudioTrimResult(
            com.bluewhale.worker.domain.dto.PublishAudioTrimDto input) {
        return publishSingleAssetResult(new SingleAssetPublish(
                "[audio_trim] publishAudioTrimResult",
                input.jobId(), input.projectId(), input.userId(), input.workerId(),
                input.fencingToken(), "audio",
                input.url(), input.storageKey(), input.mime(), input.size(), input.md5(),
                null, null,
                input.durationSec() != null ? (int) Math.round(input.durationSec() * 1000) : null,
                "音频已截取", null));
    }

    @Transactional
    public boolean failAudioTrimJob(
            com.bluewhale.worker.domain.dto.FailAudioTrimDto input) {
        return failPollingToolJob("[audio_trim] failAudioTrimJob",
                input.jobId(), input.code(), input.message(), input.details(),
                input.workerId(), input.fencingToken());
    }


    @Transactional
    public boolean publishAudioSpeedResult(
            com.bluewhale.worker.domain.dto.PublishAudioSpeedDto input) {
        return publishSingleAssetResult(new SingleAssetPublish(
                "[audio_speed] publishAudioSpeedResult",
                input.jobId(), input.projectId(), input.userId(), input.workerId(),
                input.fencingToken(), "audio",
                input.url(), input.storageKey(), input.mime(), input.size(), input.md5(),
                null, null,
                input.durationSec() != null ? (int) Math.round(input.durationSec() * 1000) : null,
                "音频已调速", null));
    }

    @Transactional
    public boolean failAudioSpeedJob(
            com.bluewhale.worker.domain.dto.FailAudioSpeedDto input) {
        return failPollingToolJob("[audio_speed] failAudioSpeedJob",
                input.jobId(), input.code(), input.message(), input.details(),
                input.workerId(), input.fencingToken());
    }

    @Transactional
    public boolean publishImageEnhanceResult(PublishImageEnhanceDto input) {
        return publishSingleAssetResult(new SingleAssetPublish(
                "[image_enhance] publishImageEnhanceResult",
                input.jobId(), input.projectId(), input.userId(), input.workerId(),
                input.fencingToken(), "image",
                input.url(), input.storageKey(), input.mime(), input.size(), input.md5(),
                input.width(), input.height(), null,
                "高清放大完成", null));
    }

    @Transactional
    public boolean publishImageEraseResult(PublishImageEraseDto input) {
        return publishSingleAssetResult(new SingleAssetPublish(
                "[image_erase] publishImageEraseResult",
                input.jobId(), input.projectId(), input.userId(), input.workerId(),
                input.fencingToken(), "image",
                input.url(), input.storageKey(), input.mime(), input.size(), input.md5(),
                input.width(), input.height(), null,
                "图片擦除完成", null));
    }

    @Transactional
    public boolean publishImageCutoutResult(PublishImageCutoutDto input) {
        return publishSingleAssetResult(new SingleAssetPublish(
                "[image_cutout] publishImageCutoutResult",
                input.jobId(), input.projectId(), input.userId(), input.workerId(),
                input.fencingToken(), "image",
                input.url(), input.storageKey(), input.mime(), input.size(), input.md5(),
                input.width(), input.height(), null,
                "图片抠图完成", null));
    }

    @Transactional
    public boolean completeJob(String jobId, List<String> assetIds,
                               String workerId, long fencingToken) {
        Long jobIdLong = Long.parseLong(jobId);

        String outputAssetIdsJson = toJson(assetIds.stream().map(Long::parseLong).toList());
        int guardAffected = jobMapper.completeJobGuard(
                jobIdLong, workerId, fencingToken, outputAssetIdsJson);
        if (guardAffected != 1) {
            log.warn("completeJob 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    jobId, workerId, fencingToken);
            return false;
        }

        List<GenerationOutputSlotEntity> slots = slotMapper.findByJobId(jobIdLong);
        String finalStatus = JobStatusEnum.SUCCEEDED.value();
        if (!slots.isEmpty()) {
            for (int i = 0; i < assetIds.size(); i++) {
                if (i < slots.size()) {
                    slotMapper.updateSlot(slots.get(i).getId(), JobStatusEnum.SUCCEEDED.value(),
                            Long.parseLong(assetIds.get(i)));
                }
            }
            for (int i = assetIds.size(); i < slots.size(); i++) {
                slotMapper.updateSlotStatus(slots.get(i).getId(), JobStatusEnum.FAILED.value());
            }
            boolean allSucceeded = assetIds.size() >= slots.size();
            boolean anySucceeded = !assetIds.isEmpty();
            if (allSucceeded) {
                finalStatus = JobStatusEnum.SUCCEEDED.value();
            } else if (anySucceeded) {
                finalStatus = JobStatusEnum.PARTIALLY_SUCCEEDED.value();
            } else {
                finalStatus = JobStatusEnum.FAILED.value();
            }
            if (!JobStatusEnum.SUCCEEDED.value().equals(finalStatus)) {
                jobMapper.updateJobStatus(jobIdLong, finalStatus);
            }
        }

        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        if (job == null) {
            throw new IllegalStateException(
                    "completeJob 守卫通过后任务 " + jobId + " 不存在，数据损坏");
        }

        publishStatusChanged(job, Map.of("job_id", job.getId().toString(),
                        "type", job.getType(),
                        "source", job.getSource(),
                        "status", job.getStatus(),
                        "progress", job.getProgress(),
                        "output_asset_ids", assetIds));

        if (job.getProjectId() == null) {
            return true;
        }

        for (int i = 0; i < assetIds.size(); i++) {
            GenerationOutputSlotEntity slot = i < slots.size() ? slots.get(i) : null;
            int slotIndex = slot != null ? slot.getSlotIndex() : i;
            eventPublisher.publish(job.getProjectId(), "generation_job.output_attached",
                    "generation_job_output",
                    job.getId().toString() + ":" + slotIndex, 0, "job_" + job.getId(),
                    Map.of("job_id", job.getId().toString(),
                            "slot_id", slot != null ? slot.getId().toString() : "",
                            "slot_index", slotIndex,
                            "status", JobStatusEnum.SUCCEEDED.value(),
                            "asset_id", assetIds.get(i),
                            "retry_of_slot_id", slot != null && slot.getRetryOfSlotId() != null
                                    ? slot.getRetryOfSlotId().toString() : "",
                            "initial_placement_status", "pending"));
        }
        for (int i = assetIds.size(); i < slots.size(); i++) {
            GenerationOutputSlotEntity slot = slots.get(i);
            eventPublisher.publish(job.getProjectId(), "generation_job.output_updated",
                    "generation_job_output",
                    job.getId().toString() + ":" + slot.getSlotIndex(), 0, "job_" + job.getId(),
                    Map.of("job_id", job.getId().toString(),
                            "slot_id", slot.getId().toString(),
                            "slot_index", slot.getSlotIndex(),
                            "status", JobStatusEnum.FAILED.value(),
                            "asset_id", "",
                            "retry_of_slot_id", slot.getRetryOfSlotId() != null
                                    ? slot.getRetryOfSlotId().toString() : "",
                            "initial_placement_status", "pending"));
        }

        GenerationOutputSlotEntity firstSlot = slots.isEmpty() ? null : slots.get(0);
        if (firstSlot != null && firstSlot.getSceneCardGenerationRecordId() != null) {
            recordSync.sync(firstSlot.getSceneCardGenerationRecordId());
        }
        previewSync.sync(jobIdLong);

        return true;
    }

    @Transactional
    public boolean failJob(String jobId, String errorCode, String errorMessage,
                           Map<String, Object> details,
                           String workerId, long fencingToken) {
        Long jobIdLong = Long.parseLong(jobId);
        Map<String, Object> errorObj = new java.util.HashMap<>();
        errorObj.put("code", errorCode);
        errorObj.put("message", errorMessage);
        if (details != null) {
            errorObj.put("details", details);
        }
        int guardAffected = jobMapper.failJobGuard(jobIdLong, workerId, fencingToken, toJson(errorObj));
        if (guardAffected != 1) {
            log.warn("failJob 守卫未命中(stale/租约失效) jobId={} workerId={} token={} errorCode={}",
                    jobId, workerId, fencingToken, errorCode);
            return false;
        }

        List<GenerationOutputSlotEntity> slots = slotMapper.findPendingByJobId(jobIdLong);
        for (GenerationOutputSlotEntity slot : slots) {
            slotMapper.updateSlotStatus(slot.getId(), JobStatusEnum.FAILED.value());
        }

        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        if (job == null) {
            throw new IllegalStateException(
                    "failJob 守卫通过后任务 " + jobId + " 不存在，数据损坏");
        }

        GenerationOutputSlotEntity firstFailSlot = slots.isEmpty() ? null : slots.get(0);
        if (firstFailSlot != null && firstFailSlot.getSceneCardGenerationRecordId() != null) {
            recordSync.sync(firstFailSlot.getSceneCardGenerationRecordId());
        }
        previewSync.sync(jobIdLong);

        insertLog(jobIdLong, JobStatusEnum.FAILED, errorCode + ": " + errorMessage,
                Map.of("code", errorCode, "message", errorMessage,
                        "details", details != null ? details : Map.of()));

        publishStatusChanged(job, Map.of("job_id", job.getId().toString(),
                        "type", job.getType(),
                        "source", job.getSource(),
                        "status", job.getStatus(),
                        "progress", job.getProgress(),
                        "error", Map.of("code", errorCode, "message", errorMessage)));
        if (job.getProjectId() != null) {
            for (GenerationOutputSlotEntity slot : slots) {
                eventPublisher.publish(job.getProjectId(), "generation_job.output_updated",
                        "generation_job_output",
                        job.getId().toString() + ":" + slot.getSlotIndex(), 0, "job_" + job.getId(),
                        Map.of("job_id", job.getId().toString(),
                                "slot_id", slot.getId().toString(),
                                "slot_index", slot.getSlotIndex(),
                                "status", JobStatusEnum.FAILED.value(),
                                "asset_id", "",
                                "retry_of_slot_id", slot.getRetryOfSlotId() != null
                                        ? slot.getRetryOfSlotId().toString() : "",
                                "initial_placement_status", "pending",
                                "error", Map.of("code", errorCode, "message", errorMessage)));
            }
        }
        return true;
    }

    @Transactional
    public String createAsset(String userId, String projectId, String generationJobId, String type,
                              String url, String storageKey, String mime, Long size, String md5,
                              Integer width, Integer height, Integer durationMs,
                              String workerId, long fencingToken) {
        Long jobIdLong = Long.parseLong(generationJobId);

        int guardAffected = jobMapper.createAssetGuard(jobIdLong, workerId, fencingToken);
        if (guardAffected != 1) {
            log.warn("createAsset 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    generationJobId, workerId, fencingToken);
            return null;
        }

        AssetEntity asset = buildAsset(jobIdLong, projectId, userId, type,
                url, storageKey, mime, size, md5, width, height, durationMs);
        assetMapper.insert(asset);

        eventPublisher.publish(Long.parseLong(projectId), "asset.created", "asset",
                asset.getId().toString(), asset.getVersion(), "job_" + generationJobId,
                Map.of("asset_id", asset.getId().toString(),
                        "generation_job_id", generationJobId,
                        "type", asset.getType(),
                        "access_url", asset.getUrl()));
        return asset.getId().toString();
    }

    @Transactional
    public boolean publishVideoResult(String jobId, String projectId, String userId,
                                      String workerId, long fencingToken,
                                      String url, String storageKey, String mime, Long size, String md5,
                                      Integer width, Integer height, double duration) {
        return publishVideoResult(jobId, projectId, userId, workerId, fencingToken,
                url, storageKey, mime, size, md5, width, height, duration,
                null, null);
    }

    private void upsertExtra(Long jobId, String extraKey, String valueType, String valueText) {
        extraMapper.upsert(jobId, extraKey, valueType, valueText);
    }

    private boolean isTwoPhaseVideo(Long jobId) {
        for (GenerationJobExtraEntity row : extraMapper.findByJobId(jobId)) {
            if ("video_stage".equals(row.getExtraKey()) && row.getValueText() != null) {
                return true;
            }
        }
        return false;
    }

    @Transactional
    public boolean publishVideoResult(String jobId, String projectId, String userId,
                                      String workerId, long fencingToken,
                                      String url, String storageKey, String mime, Long size, String md5,
                                      Integer width, Integer height, double duration,
                                      Long upstreamCreatedAtMs, Long finalizeDeadlineMs) {
        Long jobIdLong = Long.parseLong(jobId);

        int guardAffected = jobMapper.publishVideoGuard(jobIdLong, workerId, fencingToken);
        if (guardAffected != 1) {
            log.warn("[video] publishVideoResult 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    jobId, workerId, fencingToken);
            return false;
        }
        if (upstreamCreatedAtMs != null) {
            upsertExtra(jobIdLong, "upstream_created_at_ms", "number", upstreamCreatedAtMs.toString());
        }
        if (finalizeDeadlineMs != null) {
            upsertExtra(jobIdLong, "finalize_deadline_ms", "number", finalizeDeadlineMs.toString());
        }

        AssetEntity asset = buildAsset(jobIdLong, projectId, userId, "video",
                url, storageKey, mime, size, md5, width, height, duration > 0 ? (int) Math.round(duration * 1000) : null);
        assetMapper.insert(asset);

        jobMapper.updateOutputAssetIds(jobIdLong, "[" + asset.getId() + "]");

        insertLog(jobIdLong, JobStatusEnum.SUCCEEDED, "视频生成完成",
                Map.of("asset_ids", List.of(asset.getId().toString())));

        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        if (job != null) {
            if (job.getProjectId() != null) {
                eventPublisher.publish(job.getProjectId(), "asset.created", "asset",
                        asset.getId().toString(), asset.getVersion(), "job_" + job.getId(),
                        Map.of("asset_id", asset.getId().toString(),
                                "generation_job_id", job.getId().toString(),
                                "type", asset.getType(),
                                "access_url", asset.getUrl()));
            }
            publishStatusChanged(job, Map.of("job_id", job.getId().toString(),
                            "type", job.getType(),
                            "source", job.getSource(),
                            "status", job.getStatus(),
                            "progress", job.getProgress(),
                            "output_asset_ids", List.of(asset.getId().toString())));
        }

        GenerationOutputSlotEntity videoSlot = slotMapper.findByJobId(jobIdLong).stream()
                .filter(s -> s.getSlotIndex() != null && s.getSlotIndex() == 0)
                .findFirst().orElse(null);
        if (videoSlot != null) {
            slotMapper.updateSlot(videoSlot.getId(), JobStatusEnum.SUCCEEDED.value(), asset.getId());
            if (videoSlot.getSceneCardGenerationRecordId() != null) {
                recordSync.sync(videoSlot.getSceneCardGenerationRecordId());
            }
        }

        if (job != null && job.getProjectId() != null) {
            eventPublisher.publish(job.getProjectId(), "generation_job.output_attached",
                    "generation_job_output",
                    job.getId().toString() + ":" + (videoSlot != null ? videoSlot.getSlotIndex() : 0),
                    0, "job_" + job.getId(),
                    Map.of("job_id", job.getId().toString(),
                            "slot_id", videoSlot != null ? videoSlot.getId().toString() : "",
                            "slot_index", videoSlot != null ? videoSlot.getSlotIndex() : 0,
                            "status", JobStatusEnum.SUCCEEDED.value(),
                            "asset_id", asset.getId().toString(),
                            "retry_of_slot_id", videoSlot != null && videoSlot.getRetryOfSlotId() != null
                                    ? videoSlot.getRetryOfSlotId().toString() : "",
                            "initial_placement_status", "pending"));
        }
        return true;
    }

    @Transactional
    public boolean failVideoJob(String jobId, String errorCode, String errorMessage,
                                Map<String, Object> details,
                                String workerId, long fencingToken) {
        Long jobIdLong = Long.parseLong(jobId);
        Map<String, Object> errorObj = new java.util.HashMap<>();
        errorObj.put("code", errorCode);
        errorObj.put("message", errorMessage);
        if (details != null) {
            errorObj.put("details", details);
        }
        int affected = jobMapper.failVideoGuard(jobIdLong, workerId, fencingToken, toJson(errorObj));
        if (affected == 1 && isTwoPhaseVideo(jobIdLong)) {
            upsertExtra(jobIdLong, "charge_state", "string", "refunded");
        }
        if (affected != 1) {
            log.warn("[video] failVideoJob 守卫未命中(stale/租约失效) jobId={} workerId={} token={} errorCode={}",
                    jobId, workerId, fencingToken, errorCode);
            return false;
        }
        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        List<GenerationOutputSlotEntity> pendingSlots = slotMapper.findPendingByJobId(jobIdLong);
        for (GenerationOutputSlotEntity slot : pendingSlots) {
            slotMapper.updateSlotStatus(slot.getId(), JobStatusEnum.FAILED.value());
            if (slot.getSceneCardGenerationRecordId() != null) {
                recordSync.sync(slot.getSceneCardGenerationRecordId());
            }
        }
        insertLog(jobIdLong, JobStatusEnum.FAILED, errorCode + ": " + errorMessage,
                Map.of("code", errorCode, "message", errorMessage,
                        "details", details != null ? details : Map.of()));
        if (job != null) {
            publishStatusChanged(job, Map.of("job_id", job.getId().toString(),
                            "type", job.getType(),
                            "source", job.getSource(),
                            "status", job.getStatus(),
                            "progress", job.getProgress(),
                            "error", Map.of("code", errorCode, "message", errorMessage)));
        }
        if (job != null && job.getProjectId() != null) {
            for (GenerationOutputSlotEntity slot : pendingSlots) {
                eventPublisher.publish(job.getProjectId(), "generation_job.output_updated",
                        "generation_job_output",
                        job.getId().toString() + ":" + slot.getSlotIndex(), 0, "job_" + job.getId(),
                        Map.of("job_id", job.getId().toString(),
                                "slot_id", slot.getId().toString(),
                                "slot_index", slot.getSlotIndex(),
                                "status", JobStatusEnum.FAILED.value(),
                                "asset_id", "",
                                "retry_of_slot_id", slot.getRetryOfSlotId() != null
                                        ? slot.getRetryOfSlotId().toString() : "",
                                "initial_placement_status", "pending",
                                "error", Map.of("code", errorCode, "message", errorMessage)));
            }
        }
        return true;
    }

    @Transactional
    public boolean failMediaExtractJob(String jobId, String errorCode, String errorMessage,
                                       Map<String, Object> details,
                                       String workerId, long fencingToken) {
        return failPollingToolJob("[media_extract] failMediaExtractJob",
                jobId, errorCode, errorMessage, details, workerId, fencingToken);
    }

    @Transactional
    public boolean publishImageOutpaintResult(
            com.bluewhale.worker.domain.dto.PublishImageOutpaintDto input) {
        return publishSingleAssetResult(new SingleAssetPublish(
                "[image_outpaint] publishImageOutpaintResult",
                input.jobId(), input.projectId(), input.userId(), input.workerId(),
                input.fencingToken(), "image",
                input.url(), input.storageKey(), input.mime(), input.size(),
                input.md5(), input.width(), input.height(), null,
                "智能扩图完成", null));
    }

    @Transactional
    public boolean publishVocalSplitResult(
            com.bluewhale.worker.domain.dto.PublishVocalSplitDto input) {
        Long jobIdLong = Long.parseLong(input.jobId());

        int guardAffected = jobMapper.publishResultGuard(
                jobIdLong, input.workerId(), input.fencingToken());
        if (guardAffected != 1) {
            log.warn("[vocal_split] publishVocalSplitResult 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    input.jobId(), input.workerId(), input.fencingToken());
            return false;
        }

        List<AssetEntity> assets = new java.util.ArrayList<>(input.tracks().size());
        List<String> assetIds = new java.util.ArrayList<>(input.tracks().size());
        List<Map<String, Object>> trackResults = new java.util.ArrayList<>(input.tracks().size());
        for (com.bluewhale.worker.domain.dto.PublishVocalSplitDto.PublishVocalSplitTrackDto track
                : input.tracks()) {
            AssetEntity asset = buildAsset(jobIdLong, input.projectId(), input.userId(), "audio",
                    track.url(), track.storageKey(), track.mime(), track.size(), track.md5(),
                    null, null,
                    track.durationSec() != null ? (int) Math.round(track.durationSec() * 1000) : null);
            assetMapper.insert(asset);
            assets.add(asset);
            assetIds.add(asset.getId().toString());
            Map<String, Object> trackResult = new java.util.LinkedHashMap<>();
            trackResult.put("track_type", track.trackType());
            trackResult.put("asset_id", asset.getId().toString());
            trackResult.put("url", asset.getUrl());
            trackResult.put("duration", track.durationSec());
            trackResults.add(trackResult);
        }

        jobMapper.updateOutputAssetIds(jobIdLong, "[" + String.join(",", assetIds) + "]");

        insertLog(jobIdLong, JobStatusEnum.SUCCEEDED, "人声背景分离完成",
                Map.of("asset_ids", assetIds, "tracks", trackResults));

        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        if (job != null && job.getProjectId() != null) {
            for (AssetEntity asset : assets) {
                eventPublisher.publish(job.getProjectId(), "asset.created", "asset",
                        asset.getId().toString(), asset.getVersion(), "job_" + job.getId(),
                        Map.of("asset_id", asset.getId().toString(),
                                "generation_job_id", job.getId().toString(),
                                "type", asset.getType(),
                                "access_url", asset.getUrl()));
            }
        }
        if (job != null) {
            publishStatusChanged(job, Map.of("job_id", job.getId().toString(),
                            "type", job.getType(),
                            "source", job.getSource(),
                            "status", job.getStatus(),
                            "progress", job.getProgress(),
                            "output_asset_ids", assetIds));
        }
        return true;
    }

    @Transactional
    public boolean publishVideoSubtitleEraseResult(
            com.bluewhale.worker.domain.dto.PublishVideoSubtitleEraseDto input) {
        return publishSingleAssetResult(new SingleAssetPublish(
                "[video_subtitle_erase] publishVideoSubtitleEraseResult",
                input.jobId(), input.projectId(), input.userId(), input.workerId(),
                input.fencingToken(), "video",
                input.url(), input.storageKey(), input.mime(), input.size(), input.md5(),
                input.width(), input.height(),
                input.durationSec() != null ? (int) Math.round(input.durationSec() * 1000) : null,
                "视频去字幕完成", null));
    }

    @Transactional
    public boolean publishVideoEnhanceResult(
            com.bluewhale.worker.domain.dto.PublishVideoEnhanceDto input) {
        java.util.Map<String, Object> extraLogPayload = new java.util.LinkedHashMap<>();
        if (input.resolution() != null) {
            extraLogPayload.put("resolution", input.resolution());
        }
        if (input.fps() != null) {
            extraLogPayload.put("fps", input.fps());
        }
        return publishSingleAssetResult(new SingleAssetPublish(
                "[video_enhance] publishVideoEnhanceResult",
                input.jobId(), input.projectId(), input.userId(), input.workerId(),
                input.fencingToken(), "video",
                input.url(), input.storageKey(), input.mime(), input.size(), input.md5(),
                input.width(), input.height(),
                input.durationSec() != null ? (int) Math.round(input.durationSec() * 1000) : null,
                "视频 HD 高清完成", extraLogPayload));
    }

    @Transactional
    public boolean publishVideoMattingResult(
            com.bluewhale.worker.domain.dto.PublishVideoMattingDto input) {
        java.util.Map<String, Object> extraLogPayload = new java.util.LinkedHashMap<>();
        extraLogPayload.put(
                com.bluewhale.worker.domain.contract.VideoMattingContract.RESULT_KEY_VIDEO_URL,
                input.url());
        extraLogPayload.put(
                com.bluewhale.worker.domain.contract.VideoMattingContract.RESULT_KEY_RESOLUTION,
                input.resolution());
        extraLogPayload.put(
                com.bluewhale.worker.domain.contract.VideoMattingContract.RESULT_KEY_DURATION,
                input.durationSec() != null ? input.durationSec() : 0);
        return publishSingleAssetResult(new SingleAssetPublish(
                "[video_matting] publishVideoMattingResult",
                input.jobId(), input.projectId(), input.userId(), input.workerId(),
                input.fencingToken(), "video",
                input.url(), input.storageKey(), input.mime(), input.size(), input.md5(),
                input.width(), input.height(),
                input.durationSec() != null ? (int) Math.round(input.durationSec() * 1000) : null,
                "智能抠像完成", extraLogPayload));
    }

    @Transactional
    public boolean publishVideoSceneSplitResult(
            com.bluewhale.worker.domain.dto.PublishVideoSceneSplitDto input) {
        Long jobIdLong = Long.parseLong(input.jobId());

        int guardAffected = jobMapper.publishResultGuard(
                jobIdLong, input.workerId(), input.fencingToken());
        if (guardAffected != 1) {
            log.warn("[video_scene_split] publishVideoSceneSplitResult 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    input.jobId(), input.workerId(), input.fencingToken());
            return false;
        }

        List<com.bluewhale.worker.domain.dto.PublishVideoSceneSplitDto.Segment> segments =
                input.segments();
        List<AssetEntity> assets = new java.util.ArrayList<>(segments.size());
        List<String> assetIds = new java.util.ArrayList<>(segments.size());
        List<Map<String, Object>> resultSegments = new java.util.ArrayList<>(segments.size());
        for (com.bluewhale.worker.domain.dto.PublishVideoSceneSplitDto.Segment segment : segments) {
            AssetEntity asset = buildAsset(jobIdLong, input.projectId(), input.userId(), "video",
                    segment.url(), segment.storageKey(), segment.mime(), segment.size(), segment.md5(),
                    segment.width(), segment.height(),
                    (int) Math.round((segment.endTimeSec() - segment.startTimeSec()) * 1000));
            assetMapper.insert(asset);
            assets.add(asset);
            assetIds.add(asset.getId().toString());
            Map<String, Object> resultSegment = new java.util.LinkedHashMap<>();
            resultSegment.put(
                    com.bluewhale.worker.domain.contract.VideoSceneSplitContract.SEGMENT_KEY_INDEX,
                    segment.segmentIndex());
            resultSegment.put(
                    com.bluewhale.worker.domain.contract.VideoSceneSplitContract.SEGMENT_KEY_START_TIME,
                    segment.startTimeSec());
            resultSegment.put(
                    com.bluewhale.worker.domain.contract.VideoSceneSplitContract.SEGMENT_KEY_END_TIME,
                    segment.endTimeSec());
            resultSegment.put(
                    com.bluewhale.worker.domain.contract.VideoSceneSplitContract.SEGMENT_KEY_ASSET_ID,
                    asset.getId().toString());
            resultSegments.add(resultSegment);
        }

        jobMapper.updateOutputAssetIds(jobIdLong,
                toJson(assetIds.stream().map(Long::parseLong).toList()));

        Map<String, Object> resultMeta = new java.util.LinkedHashMap<>();
        resultMeta.put("asset_ids", assetIds);
        resultMeta.put(
                com.bluewhale.worker.domain.contract.VideoSceneSplitContract.RESULT_KEY_DURATION,
                input.durationSec() != null ? input.durationSec() : 0);
        resultMeta.put(
                com.bluewhale.worker.domain.contract.VideoSceneSplitContract.RESULT_KEY_SEGMENTS,
                resultSegments);
        insertLog(jobIdLong, JobStatusEnum.SUCCEEDED, "场景切分完成", resultMeta);

        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        if (job != null && job.getProjectId() != null) {
            for (int i = 0; i < assets.size(); i++) {
                AssetEntity asset = assets.get(i);
                eventPublisher.publish(job.getProjectId(), "asset.created", "asset",
                        asset.getId().toString(), asset.getVersion(), "job_" + job.getId(),
                        Map.of("asset_id", asset.getId().toString(),
                                "generation_job_id", job.getId().toString(),
                                "type", asset.getType(),
                                "access_url", asset.getUrl()));
            }
        }
        if (job != null) {
            Map<String, Object> resultPayload = new java.util.LinkedHashMap<>();
            resultPayload.put(
                    com.bluewhale.worker.domain.contract.VideoSceneSplitContract.RESULT_KEY_DURATION,
                    input.durationSec() != null ? input.durationSec() : 0);
            resultPayload.put(
                    com.bluewhale.worker.domain.contract.VideoSceneSplitContract.RESULT_KEY_SEGMENTS,
                    resultSegments);
            publishStatusChanged(job, Map.of("job_id", job.getId().toString(),
                            "type", job.getType(),
                            "source", job.getSource(),
                            "status", job.getStatus(),
                            "progress", job.getProgress(),
                            "output_asset_ids", assetIds,
                            "result", resultPayload));
        }
        return true;
    }

    @Transactional
    public boolean publishVideoFrameInterpolationResult(
            com.bluewhale.worker.domain.dto.PublishVideoFrameInterpolationDto input) {
        java.util.Map<String, Object> extraLogPayload = new java.util.LinkedHashMap<>();
        if (input.durationSec() != null) {
            extraLogPayload.put(
                    com.bluewhale.worker.domain.contract.VideoFrameInterpolationContract.RESULT_KEY_DURATION,
                    input.durationSec());
        }
        if (input.resolution() != null) {
            extraLogPayload.put(
                    com.bluewhale.worker.domain.contract.VideoFrameInterpolationContract.RESULT_KEY_RESOLUTION,
                    input.resolution());
        }
        if (input.fps() != null) {
            extraLogPayload.put(
                    com.bluewhale.worker.domain.contract.VideoFrameInterpolationContract.RESULT_KEY_FPS,
                    input.fps());
        }
        return publishSingleAssetResult(new SingleAssetPublish(
                "[video_frame_interpolation] publishVideoFrameInterpolationResult",
                input.jobId(), input.projectId(), input.userId(), input.workerId(),
                input.fencingToken(), "video",
                input.url(), input.storageKey(), input.mime(), input.size(), input.md5(),
                input.width(), input.height(),
                input.durationSec() != null ? (int) Math.round(input.durationSec() * 1000) : null,
                "视频插帧完成", extraLogPayload));
    }


    private boolean publishSingleAssetResult(SingleAssetPublish p) {
        Long jobIdLong = Long.parseLong(p.jobId());

        int guardAffected = jobMapper.publishResultGuard(
                jobIdLong, p.workerId(), p.fencingToken());
        if (guardAffected != 1) {
            log.warn("{} 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    p.logTag(), p.jobId(), p.workerId(), p.fencingToken());
            return false;
        }

        AssetEntity asset = buildAsset(jobIdLong, p.projectId(), p.userId(), p.assetType(),
                p.url(), p.storageKey(), p.mime(), p.size(), p.md5(),
                p.width(), p.height(), p.durationMs(), p.name());
        assetMapper.insert(asset);

        jobMapper.updateOutputAssetIds(jobIdLong, "[" + asset.getId() + "]");

        Map<String, Object> logPayload = new java.util.HashMap<>();
        logPayload.put("asset_ids", List.of(asset.getId().toString()));
        if (p.extraLogPayload() != null) {
            logPayload.putAll(p.extraLogPayload());
        }
        insertLog(jobIdLong, JobStatusEnum.SUCCEEDED, p.successMessage(), logPayload);

        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        if (job != null) {
            if (job.getProjectId() != null) {
                eventPublisher.publish(job.getProjectId(), "asset.created", "asset",
                        asset.getId().toString(), asset.getVersion(), "job_" + job.getId(),
                        Map.of("asset_id", asset.getId().toString(),
                                "generation_job_id", job.getId().toString(),
                                "type", asset.getType(),
                                "access_url", asset.getUrl()));
            }
            publishStatusChanged(job, Map.of("job_id", job.getId().toString(),
                            "type", job.getType(),
                            "source", job.getSource(),
                            "status", job.getStatus(),
                            "progress", job.getProgress(),
                            "output_asset_ids", List.of(asset.getId().toString())));
        }
        return true;
    }

    private record SingleAssetPublish(
            String logTag,
            String jobId, String projectId, String userId, String workerId, long fencingToken,
            String assetType,
            String url, String storageKey, String mime, Long size, String md5,
            Integer width, Integer height, Integer durationMs,
            String successMessage,
            Map<String, Object> extraLogPayload,
            String name
    ) {
        SingleAssetPublish(String logTag, String jobId, String projectId, String userId, String workerId,
                           long fencingToken, String assetType, String url, String storageKey, String mime,
                           Long size, String md5, Integer width, Integer height, Integer durationMs,
                           String successMessage, Map<String, Object> extraLogPayload) {
            this(logTag, jobId, projectId, userId, workerId, fencingToken, assetType, url, storageKey, mime,
                    size, md5, width, height, durationMs, successMessage, extraLogPayload, null);
        }
    }

    private boolean failPollingToolJob(String logTag, String jobId, String errorCode,
                                       String errorMessage, Map<String, Object> details,
                                       String workerId, long fencingToken) {
        Long jobIdLong = Long.parseLong(jobId);

        Map<String, Object> errorObj = new java.util.HashMap<>();
        errorObj.put("code", errorCode);
        errorObj.put("message", errorMessage);
        if (details != null) {
            errorObj.put("details", details);
        }
        String errorJson = toJson(errorObj);

        int guardAffected = jobMapper.failMediaExtractGuard(
                jobIdLong, workerId, fencingToken, errorJson);
        if (guardAffected != 1) {
            log.warn("{} 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    logTag, jobId, workerId, fencingToken);
            return false;
        }

        insertLog(jobIdLong, JobStatusEnum.FAILED, errorCode + ": " + errorMessage,
                Map.of("code", errorCode, "message", errorMessage,
                        "details", details != null ? details : Map.of()));

        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        if (job != null) {
            publishStatusChanged(job, Map.of("job_id", job.getId().toString(),
                            "type", job.getType(),
                            "source", job.getSource(),
                            "status", job.getStatus(),
                            "progress", job.getProgress(),
                            "error", Map.of("code", errorCode, "message", errorMessage)));
        }
        return true;
    }


    private void publishStatusChanged(GenerationJobEntity job, Map<String, Object> payload) {
        if (job.getProjectId() != null) {
            eventPublisher.publish(job.getProjectId(), "generation_job.status_changed",
                    "generation_job", job.getId().toString(), job.getVersion(), "job_" + job.getId(),
                    payload);
        }
        settlementPublisher.publishTerminal(job, payload);
    }

    public void releaseHoldForCancelled(String jobId) {
        GenerationJobEntity job = jobMapper.selectById(Long.parseLong(jobId));
        if (job == null) {
            log.warn("[cancel] 取不到 job，无法发布终态事件：jobId={}", jobId);
            return;
        }
        publishStatusChanged(job, Map.of("job_id", job.getId().toString(),
                "type", job.getType(),
                "source", job.getSource(),
                "status", job.getStatus(),
                "progress", job.getProgress()));
    }

    private AssetEntity buildAsset(Long jobIdLong, String projectId, String userId, String type,
                                   String url, String storageKey, String mime, Long size, String md5,
                                   Integer width, Integer height, Integer durationMs) {
        return buildAsset(jobIdLong, projectId, userId, type, url, storageKey, mime, size, md5,
                width, height, durationMs, null);
    }

    private AssetEntity buildAsset(Long jobIdLong, String projectId, String userId, String type,
                                   String url, String storageKey, String mime, Long size, String md5,
                                   Integer width, Integer height, Integer durationMs, String name) {
        AssetEntity asset = new AssetEntity();
        asset.setUserId(Long.parseLong(userId));
        asset.setProjectId(Long.parseLong(projectId));
        asset.setGenerationJobId(jobIdLong);
        asset.setType(type);
        asset.setName(name);
        asset.setUrl(url);
        asset.setStorageKey(storageKey);
        asset.setMime(mime);
        asset.setSize(size);
        asset.setMd5(md5);
        asset.setWidth(width);
        asset.setHeight(height);
        if (durationMs != null) {
            asset.setDurationMs(durationMs);
        }
        asset.setSource("generated");
        asset.setStatus("normal");
        asset.setVersion(0);
        asset.setIsDelete(false);
        return asset;
    }

    private void insertLog(Long jobIdLong, JobStatusEnum status, String message,
                           Map<String, Object> payload) {
        GenerationJobLogEntity logEntry = new GenerationJobLogEntity();
        logEntry.setGenerationJobId(jobIdLong);
        logEntry.setEvent(status.value());
        logEntry.setStatus(status.value());
        logEntry.setMessage(message);
        if (payload != null) {
            logEntry.setPayload(toJson(payload));
        }
        logEntry.setOccurredAt(LocalDateTime.now());
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
