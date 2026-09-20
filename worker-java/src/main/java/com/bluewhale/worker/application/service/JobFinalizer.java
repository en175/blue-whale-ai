package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.domain.entity.GenerationJobLogEntity;
import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;
import com.bluewhale.worker.domain.contract.JobStatusEnum;
import com.bluewhale.worker.domain.dto.PublishImageCutoutDto;
import com.bluewhale.worker.domain.dto.PublishImageEnhanceDto;
import com.bluewhale.worker.domain.dto.PublishImageEraseDto;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationOutputSlotMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

/**
 * 作业终态收口（刀④ 拆分自 JobStateMachineService 的 complete/fail/publish/createAsset 族）。
 * <p>
 * 契约 §3.3 单事务原子：guard CAS → 结果写入 → 日志 → 事件 → 摘要同步。全部
 * guard fail 一律静默返回 false（不抛，stale worker 交给租约 + recovery）。
 * <p>
 * 媒体差异 = payload 组装（asset 类型、单槽 vs 多槽、事件槽位语义）。第 5 类扩展触点：
 * 新增 publish/fail payload 组装策略（契约附录 C），不复制方法三元组。
 */
@Service
public class JobFinalizer {

    private static final Logger log = LoggerFactory.getLogger(JobFinalizer.class);

    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();

    private final GenerationJobMapper jobMapper;
    private final AssetMapper assetMapper;
    private final GenerationJobLogMapper jobLogMapper;
    private final GenerationOutputSlotMapper slotMapper;
    private final SceneCardGenerationRecordSync recordSync;
    private final StoryboardPreviewSync previewSync;
    private final ProjectEventPublisher eventPublisher;

    public JobFinalizer(
            GenerationJobMapper jobMapper,
            AssetMapper assetMapper,
            GenerationJobLogMapper jobLogMapper,
            GenerationOutputSlotMapper slotMapper,
            SceneCardGenerationRecordSync recordSync,
            StoryboardPreviewSync previewSync,
            ProjectEventPublisher eventPublisher
    ) {
        this.jobMapper = jobMapper;
        this.assetMapper = assetMapper;
        this.jobLogMapper = jobLogMapper;
        this.slotMapper = slotMapper;
        this.recordSync = recordSync;
        this.previewSync = previewSync;
        this.eventPublisher = eventPublisher;
    }

    /**
     * 发布 media_extract 结果（media-extract-ops.ts:45-135）。
     */
    @Transactional
    public boolean publishMediaExtractResult(
            String jobId, String projectId, String userId, String workerId, long fencingToken,
            String url, String storageKey, String mime, Long size, String md5, Double duration
    ) {
        Long jobIdLong = Long.parseLong(jobId);

        int guardAffected = jobMapper.publishMediaExtractGuard(jobIdLong, workerId, fencingToken);
        if (guardAffected != 1) {
            log.warn("[media_extract] publishMediaExtractResult 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    jobId, workerId, fencingToken);
            return false;
        }

        AssetEntity asset = buildAsset(jobIdLong, projectId, userId, "audio",
                url, storageKey, mime, size, md5, null, null,
                duration != null ? (int) Math.round(duration * 1000) : null);
        assetMapper.insert(asset);

        jobMapper.updateOutputAssetIds(jobIdLong, "[" + asset.getId() + "]");

        insertLog(jobIdLong, JobStatusEnum.SUCCEEDED, "音频已提取",
                Map.of("asset_ids", List.of(asset.getId().toString())));

        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        // 两个事件都在 job.project_id 守卫内（media-extract-ops.ts:102 逐字：asset.created 与
        // status_changed 同处 `if (job.project_id != null)`；与通用 createAsset 的恒发不同）。
        if (job != null && job.getProjectId() != null) {
            eventPublisher.publish(job.getProjectId(), "asset.created", "asset",
                    asset.getId().toString(), asset.getVersion(), "job_" + job.getId(),
                    Map.of("asset_id", asset.getId().toString(),
                            "generation_job_id", job.getId().toString(),
                            "type", asset.getType(),
                            "access_url", asset.getUrl()));
            eventPublisher.publish(job.getProjectId(), "generation_job.status_changed",
                    "generation_job", job.getId().toString(), job.getVersion(), "job_" + job.getId(),
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
     * 发布 image_enhance 结果（契约 §14.5 / IKGM9D，附录 C 触点⑤）。
     * <p>
     * 免费工具无结算联动，同 publishMediaExtractResult 形态（单槽单 asset、双事件），
     * 差异 = Asset type='image' / source='generated' 且带宽高（结果图 ImageIO 解析，
     * 解析失败静默 null，契约 §8 等价标准）。守卫复用 publishMediaExtractGuard / updateOutputAssetIds
     * （两 SQL 均无 type 过滤，语义 = 单槽免费工具终态收口）。
     */
    @Transactional
    public boolean publishImageEnhanceResult(PublishImageEnhanceDto input) {
        Long jobIdLong = Long.parseLong(input.jobId());

        int guardAffected = jobMapper.publishMediaExtractGuard(
                jobIdLong, input.workerId(), input.fencingToken());
        if (guardAffected != 1) {
            log.warn("[image_enhance] publishImageEnhanceResult 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    input.jobId(), input.workerId(), input.fencingToken());
            return false;
        }

        AssetEntity asset = buildAsset(jobIdLong, input.projectId(), input.userId(), "image",
                input.url(), input.storageKey(), input.mime(), input.size(), input.md5(),
                input.width(), input.height(), null);
        assetMapper.insert(asset);

        jobMapper.updateOutputAssetIds(jobIdLong, "[" + asset.getId() + "]");

        insertLog(jobIdLong, JobStatusEnum.SUCCEEDED, "高清放大完成",
                Map.of("asset_ids", List.of(asset.getId().toString())));

        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        // 双事件同 extract 的 project_id 守卫形态；前端按 input.target_node_id 回填目标高清卡（源卡不动）。
        if (job != null && job.getProjectId() != null) {
            eventPublisher.publish(job.getProjectId(), "asset.created", "asset",
                    asset.getId().toString(), asset.getVersion(), "job_" + job.getId(),
                    Map.of("asset_id", asset.getId().toString(),
                            "generation_job_id", job.getId().toString(),
                            "type", asset.getType(),
                            "access_url", asset.getUrl()));
            eventPublisher.publish(job.getProjectId(), "generation_job.status_changed",
                    "generation_job", job.getId().toString(), job.getVersion(), "job_" + job.getId(),
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
     * 发布 image_erase 结果（契约 §15.5 / IKGOT6，附录 C 触点⑤）。
     * <p>
     * 免费工具无结算联动，同 publishImageEnhanceResult 形态（单槽单 asset、双事件），
     * Asset type='image' / source='generated' 且带宽高（结果图 ImageIO 解析，
     * 解析失败静默 null，契约 §8 等价标准）。守卫复用 publishMediaExtractGuard / updateOutputAssetIds
     * （两 SQL 均无 type 过滤，语义 = 单槽免费工具终态收口）。
     */
    @Transactional
    public boolean publishImageEraseResult(PublishImageEraseDto input) {
        Long jobIdLong = Long.parseLong(input.jobId());

        int guardAffected = jobMapper.publishMediaExtractGuard(
                jobIdLong, input.workerId(), input.fencingToken());
        if (guardAffected != 1) {
            log.warn("[image_erase] publishImageEraseResult 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    input.jobId(), input.workerId(), input.fencingToken());
            return false;
        }

        AssetEntity asset = buildAsset(jobIdLong, input.projectId(), input.userId(), "image",
                input.url(), input.storageKey(), input.mime(), input.size(), input.md5(),
                input.width(), input.height(), null);
        assetMapper.insert(asset);

        jobMapper.updateOutputAssetIds(jobIdLong, "[" + asset.getId() + "]");

        insertLog(jobIdLong, JobStatusEnum.SUCCEEDED, "图片擦除完成",
                Map.of("asset_ids", List.of(asset.getId().toString())));

        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        // 双事件同 extract/enhance 的 project_id 守卫形态；前端按 input.target_node_id 回填擦除结果卡（源卡不动）。
        if (job != null && job.getProjectId() != null) {
            eventPublisher.publish(job.getProjectId(), "asset.created", "asset",
                    asset.getId().toString(), asset.getVersion(), "job_" + job.getId(),
                    Map.of("asset_id", asset.getId().toString(),
                            "generation_job_id", job.getId().toString(),
                            "type", asset.getType(),
                            "access_url", asset.getUrl()));
            eventPublisher.publish(job.getProjectId(), "generation_job.status_changed",
                    "generation_job", job.getId().toString(), job.getVersion(), "job_" + job.getId(),
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
     * 发布 image_cutout 结果（契约章节 docs/specs/2026-09-18-image-cutout-mediakit.md / IKGXM2）。
     * <p>
     * 免费工具无结算联动，同 publishImageEraseResult 形态（单槽单 asset、双事件），
     * Asset type='image' / source='generated' 且带宽高（优先取官方响应 result.image_width/
     * image_height，缺失时结果图 ImageIO 解析兜底，解析失败静默 null，契约 §8 等价标准）。
     * 守卫复用 publishMediaExtractGuard / updateOutputAssetIds（两 SQL 均无 type 过滤，
     * 语义 = 单槽免费工具终态收口）。
     */
    @Transactional
    public boolean publishImageCutoutResult(PublishImageCutoutDto input) {
        Long jobIdLong = Long.parseLong(input.jobId());

        int guardAffected = jobMapper.publishMediaExtractGuard(
                jobIdLong, input.workerId(), input.fencingToken());
        if (guardAffected != 1) {
            log.warn("[image_cutout] publishImageCutoutResult 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    input.jobId(), input.workerId(), input.fencingToken());
            return false;
        }

        AssetEntity asset = buildAsset(jobIdLong, input.projectId(), input.userId(), "image",
                input.url(), input.storageKey(), input.mime(), input.size(), input.md5(),
                input.width(), input.height(), null);
        assetMapper.insert(asset);

        jobMapper.updateOutputAssetIds(jobIdLong, "[" + asset.getId() + "]");

        insertLog(jobIdLong, JobStatusEnum.SUCCEEDED, "图片抠图完成",
                Map.of("asset_ids", List.of(asset.getId().toString())));

        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        // 双事件同 extract/enhance/erase 的 project_id 守卫形态；前端按 input.target_node_id 回填抠图结果卡（源卡不动）。
        if (job != null && job.getProjectId() != null) {
            eventPublisher.publish(job.getProjectId(), "asset.created", "asset",
                    asset.getId().toString(), asset.getVersion(), "job_" + job.getId(),
                    Map.of("asset_id", asset.getId().toString(),
                            "generation_job_id", job.getId().toString(),
                            "type", asset.getType(),
                            "access_url", asset.getUrl()));
            eventPublisher.publish(job.getProjectId(), "generation_job.status_changed",
                    "generation_job", job.getId().toString(), job.getVersion(), "job_" + job.getId(),
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
     * 完成作业（settle-ops.ts:53-206 completeJob + completeJobInTx）。
     * 音频/图片共用（generation-worker.ts:445/684 finishJob）。
     */
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

        // 无 project_id → 提前返回（不写事件、不写摘要；settle-ops.ts:130 逐字：
        // project_id === null 早退发生在两个 sync 之前，非「无条件调用」）。
        if (job.getProjectId() == null) {
            return true;
        }

        eventPublisher.publish(job.getProjectId(), "generation_job.status_changed",
                "generation_job", job.getId().toString(), job.getVersion(), "job_" + job.getId(),
                Map.of("job_id", job.getId().toString(),
                        "type", job.getType(),
                        "source", job.getSource(),
                        "status", job.getStatus(),
                        "progress", job.getProgress(),
                        "output_asset_ids", assetIds));

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

        // 摘要同步（settle-ops.ts:196-204：firstSlot 关联 record 时回写；storyboard 无条件调用）
        GenerationOutputSlotEntity firstSlot = slots.isEmpty() ? null : slots.get(0);
        if (firstSlot != null && firstSlot.getSceneCardGenerationRecordId() != null) {
            recordSync.sync(firstSlot.getSceneCardGenerationRecordId());
        }
        previewSync.sync(jobIdLong);

        return true;
    }

    /**
     * 失败作业（settle-ops.ts:206-333 failJob）。
     */
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

        // 摘要同步（settle-ops.ts:322-327 firstSlot record 回写；329-330 storyboard 无条件）
        GenerationOutputSlotEntity firstFailSlot = slots.isEmpty() ? null : slots.get(0);
        if (firstFailSlot != null && firstFailSlot.getSceneCardGenerationRecordId() != null) {
            recordSync.sync(firstFailSlot.getSceneCardGenerationRecordId());
        }
        previewSync.sync(jobIdLong);

        insertLog(jobIdLong, JobStatusEnum.FAILED, errorCode + ": " + errorMessage,
                Map.of("code", errorCode, "message", errorMessage,
                        "details", details != null ? details : Map.of()));

        if (job.getProjectId() != null) {
            eventPublisher.publish(job.getProjectId(), "generation_job.status_changed",
                    "generation_job", job.getId().toString(), job.getVersion(), "job_" + job.getId(),
                    Map.of("job_id", job.getId().toString(),
                            "type", job.getType(),
                            "source", job.getSource(),
                            "status", job.getStatus(),
                            "progress", job.getProgress(),
                            "error", Map.of("code", errorCode, "message", errorMessage)));
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

    /**
     * 建资产行（asset-ops.ts:156-202 createAsset）。
     */
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

        // asset.created（asset-ops.ts:186-199，恒发）
        eventPublisher.publish(Long.parseLong(projectId), "asset.created", "asset",
                asset.getId().toString(), asset.getVersion(), "job_" + generationJobId,
                Map.of("asset_id", asset.getId().toString(),
                        "generation_job_id", generationJobId,
                        "type", asset.getType(),
                        "access_url", asset.getUrl()));
        return asset.getId().toString();
    }

    /**
     * 发布视频结果（video-ops.ts:60-198 publishVideoResult）。
     * 单槽语义（评审 I2）：findFirst slot_index=0；只回写 record summary，不调 storyboard。
     */
    @Transactional
    public boolean publishVideoResult(String jobId, String projectId, String userId,
                                      String workerId, long fencingToken,
                                      String url, String storageKey, String mime, Long size, String md5,
                                      Integer width, Integer height, double duration) {
        Long jobIdLong = Long.parseLong(jobId);

        int guardAffected = jobMapper.publishVideoGuard(jobIdLong, workerId, fencingToken);
        if (guardAffected != 1) {
            log.warn("[video] publishVideoResult 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    jobId, workerId, fencingToken);
            return false;
        }

        AssetEntity asset = buildAsset(jobIdLong, projectId, userId, "video",
                url, storageKey, mime, size, md5, width, height, duration > 0 ? (int) Math.round(duration * 1000) : null);
        assetMapper.insert(asset);

        jobMapper.updateOutputAssetIds(jobIdLong, "[" + asset.getId() + "]");

        insertLog(jobIdLong, JobStatusEnum.SUCCEEDED, "视频生成完成",
                Map.of("asset_ids", List.of(asset.getId().toString())));

        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        if (job != null && job.getProjectId() != null) {
            eventPublisher.publish(job.getProjectId(), "asset.created", "asset",
                    asset.getId().toString(), asset.getVersion(), "job_" + job.getId(),
                    Map.of("asset_id", asset.getId().toString(),
                            "generation_job_id", job.getId().toString(),
                            "type", asset.getType(),
                            "access_url", asset.getUrl()));
            eventPublisher.publish(job.getProjectId(), "generation_job.status_changed",
                    "generation_job", job.getId().toString(), job.getVersion(), "job_" + job.getId(),
                    Map.of("job_id", job.getId().toString(),
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

    /**
     * 失败视频作业（video-ops.ts:200-303 failVideoJob 独立实现）。
     * 与通用 failJob 的逐字差异：守卫多清 next_poll_at；pending 槽逐个带 record FK 回写 summary；
     * 不调 storyboard 同步。
     */
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
        if (job != null && job.getProjectId() != null) {
            eventPublisher.publish(job.getProjectId(), "generation_job.status_changed",
                    "generation_job", job.getId().toString(), job.getVersion(), "job_" + job.getId(),
                    Map.of("job_id", job.getId().toString(),
                            "type", job.getType(),
                            "source", job.getSource(),
                            "status", job.getStatus(),
                            "progress", job.getProgress(),
                            "error", Map.of("code", errorCode, "message", errorMessage)));
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

    /**
     * 失败 media_extract 作业（media-extract-ops.ts:138-192 failMediaExtractJob）。
     */
    @Transactional
    public boolean failMediaExtractJob(String jobId, String errorCode, String errorMessage,
                                       Map<String, Object> details,
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
            log.warn("[media_extract] failMediaExtractJob 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    jobId, workerId, fencingToken);
            return false;
        }

        insertLog(jobIdLong, JobStatusEnum.FAILED, errorCode + ": " + errorMessage,
                Map.of("code", errorCode, "message", errorMessage,
                        "details", details != null ? details : Map.of()));

        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        if (job != null && job.getProjectId() != null) {
            eventPublisher.publish(job.getProjectId(), "generation_job.status_changed",
                    "generation_job", job.getId().toString(), job.getVersion(), "job_" + job.getId(),
                    Map.of("job_id", job.getId().toString(),
                            "type", job.getType(),
                            "source", job.getSource(),
                            "status", job.getStatus(),
                            "progress", job.getProgress(),
                            "error", Map.of("code", errorCode, "message", errorMessage)));
        }
        return true;
    }

    /**
     * 发布 image_outpaint 结果（IKGOQW）。
     * <p>
     * 与 publishImageEnhanceResult 同构（免费工具无结算联动、单槽单 asset、双事件），
     * Asset type='image' / source='generated'。守卫复用 publishMediaExtractGuard /
     * updateOutputAssetIds（两 SQL 均无 type 过滤，语义 = 单槽免费工具终态收口）。
     */
    @Transactional
    public boolean publishImageOutpaintResult(
            com.bluewhale.worker.domain.dto.PublishImageOutpaintDto input) {
        Long jobIdLong = Long.parseLong(input.jobId());

        int guardAffected = jobMapper.publishMediaExtractGuard(
                jobIdLong, input.workerId(), input.fencingToken());
        if (guardAffected != 1) {
            log.warn("[image_outpaint] publishImageOutpaintResult 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    input.jobId(), input.workerId(), input.fencingToken());
            return false;
        }

        AssetEntity asset = buildAsset(jobIdLong, input.projectId(), input.userId(), "image",
                input.url(), input.storageKey(), input.mime(), input.size(),
                input.md5(), input.width(), input.height(), null);
        assetMapper.insert(asset);

        jobMapper.updateOutputAssetIds(jobIdLong, "[" + asset.getId() + "]");

        insertLog(jobIdLong, JobStatusEnum.SUCCEEDED, "智能扩图完成",
                Map.of("asset_ids", List.of(asset.getId().toString())));

        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        // 双事件同 extract / enhance 的 project_id 守卫形态；前端按 input.target_node_id
        // 回填扩图结果卡（源卡不动）。
        if (job != null && job.getProjectId() != null) {
            eventPublisher.publish(job.getProjectId(), "asset.created", "asset",
                    asset.getId().toString(), asset.getVersion(), "job_" + job.getId(),
                    Map.of("asset_id", asset.getId().toString(),
                            "generation_job_id", job.getId().toString(),
                            "type", asset.getType(),
                            "access_url", asset.getUrl()));
            eventPublisher.publish(job.getProjectId(), "generation_job.status_changed",
                    "generation_job", job.getId().toString(), job.getVersion(), "job_" + job.getId(),
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
     * 发布 video_subtitle_erase 结果（迁移契约 §17.5 / IKGZ81，附录 C 触点⑤）。
     * <p>
     * 免费工具无结算联动，同 publishImageEraseResult 形态（单槽单 asset、双事件），
     * 差异 = Asset type='video' 且带宽 durationSec（官方 result.duration 秒；宽高为源
     * Asset 近似值，官方不返回输出元数据，§8 静默 null 等价标准）。守卫复用
     * publishMediaExtractGuard / updateOutputAssetIds（两 SQL 均无 type 过滤，
     * 语义 = 单槽免费工具终态收口）。
     */
    @Transactional
    public boolean publishVideoSubtitleEraseResult(
            com.bluewhale.worker.domain.dto.PublishVideoSubtitleEraseDto input) {
        Long jobIdLong = Long.parseLong(input.jobId());

        int guardAffected = jobMapper.publishMediaExtractGuard(
                jobIdLong, input.workerId(), input.fencingToken());
        if (guardAffected != 1) {
            log.warn("[video_subtitle_erase] publishVideoSubtitleEraseResult 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    input.jobId(), input.workerId(), input.fencingToken());
            return false;
        }

        AssetEntity asset = buildAsset(jobIdLong, input.projectId(), input.userId(), "video",
                input.url(), input.storageKey(), input.mime(), input.size(), input.md5(),
                input.width(), input.height(),
                input.durationSec() != null ? (int) Math.round(input.durationSec() * 1000) : null);
        assetMapper.insert(asset);

        jobMapper.updateOutputAssetIds(jobIdLong, "[" + asset.getId() + "]");

        insertLog(jobIdLong, JobStatusEnum.SUCCEEDED, "视频去字幕完成",
                Map.of("asset_ids", List.of(asset.getId().toString())));

        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        // 双事件同 extract/erase 的 project_id 守卫形态；前端按 input.target_node_id 回填去字幕
        // 结果卡（源卡不动，结果卡可再次去字幕，§17.5）。
        if (job != null && job.getProjectId() != null) {
            eventPublisher.publish(job.getProjectId(), "asset.created", "asset",
                    asset.getId().toString(), asset.getVersion(), "job_" + job.getId(),
                    Map.of("asset_id", asset.getId().toString(),
                            "generation_job_id", job.getId().toString(),
                            "type", asset.getType(),
                            "access_url", asset.getUrl()));
            eventPublisher.publish(job.getProjectId(), "generation_job.status_changed",
                    "generation_job", job.getId().toString(), job.getVersion(), "job_" + job.getId(),
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
     * 发布 video_enhance 结果（IKH3VF，父规格 IKH3VB，附录 C 触点⑤）。
     * <p>
     * 免费工具无结算联动，同 publishVideoSubtitleEraseResult 形态（单槽单 asset、双事件），
     * 差异 = 宽高由 processor 按目标分辨率档位推导（官方不返回输出像素）、带宽
     * resolution / fps——assets 无对应列，两值落终态日志 payload（结果字段入库的承载位）。
     * 守卫复用 publishMediaExtractGuard / updateOutputAssetIds（两 SQL 均无 type 过滤，
     * 语义 = 单槽免费工具终态收口）。
     */
    @Transactional
    public boolean publishVideoEnhanceResult(
            com.bluewhale.worker.domain.dto.PublishVideoEnhanceDto input) {
        Long jobIdLong = Long.parseLong(input.jobId());

        int guardAffected = jobMapper.publishMediaExtractGuard(
                jobIdLong, input.workerId(), input.fencingToken());
        if (guardAffected != 1) {
            log.warn("[video_enhance] publishVideoEnhanceResult 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    input.jobId(), input.workerId(), input.fencingToken());
            return false;
        }

        AssetEntity asset = buildAsset(jobIdLong, input.projectId(), input.userId(), "video",
                input.url(), input.storageKey(), input.mime(), input.size(), input.md5(),
                input.width(), input.height(),
                input.durationSec() != null ? (int) Math.round(input.durationSec() * 1000) : null);
        assetMapper.insert(asset);

        jobMapper.updateOutputAssetIds(jobIdLong, "[" + asset.getId() + "]");

        // 结果字段入库：assets 承载 url/宽高/时长；resolution 档位与 fps（assets 无列）落日志 payload
        java.util.Map<String, Object> resultMeta = new java.util.HashMap<>();
        resultMeta.put("asset_ids", List.of(asset.getId().toString()));
        if (input.resolution() != null) {
            resultMeta.put("resolution", input.resolution());
        }
        if (input.fps() != null) {
            resultMeta.put("fps", input.fps());
        }
        insertLog(jobIdLong, JobStatusEnum.SUCCEEDED, "视频 HD 高清完成", resultMeta);

        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        // 双事件同 extract/erase 的 project_id 守卫形态；前端按 input.target_node_id 回填
        // HD 高清结果卡（源卡不动，ADR-0105）。
        if (job != null && job.getProjectId() != null) {
            eventPublisher.publish(job.getProjectId(), "asset.created", "asset",
                    asset.getId().toString(), asset.getVersion(), "job_" + job.getId(),
                    Map.of("asset_id", asset.getId().toString(),
                            "generation_job_id", job.getId().toString(),
                            "type", asset.getType(),
                            "access_url", asset.getUrl()));
            eventPublisher.publish(job.getProjectId(), "generation_job.status_changed",
                    "generation_job", job.getId().toString(), job.getVersion(), "job_" + job.getId(),
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
     * 发布 video_scene_split 结果（IKH8BP，父规格 IKH86V，附录 C 触点⑤）。
     * <p>
     * 免费工具无结算联动，同 {@link #publishVideoEnhanceResult} 形态（守卫复用
     * publishMediaExtractGuard），差异 = **一对多**：N 段切片逐段建 Asset（type='video' /
     * source='generated'，duration_ms = 段时长；宽高为源 Asset 近似值——切片不改变分辨率），
     * output_asset_ids 落全部段资产 id 数组（1 段与 N 段同构不特判）。
     * <p>
     * **段序 / 起止秒 / 段资产引用 / 总时长按契约 result 键跨进程回传**（generation_jobs 无
     * result 列，家族承载位双通道）：终态日志 payload（入库承载，video_enhance 的
     * resolution/fps 先例）+ status_changed 事件 payload 的 result 键（前端完成事件驱动
     * 移除任务占位卡、按 result.segments[] 逐段扇出段卡，ADR-0108）。每段另发 asset.created
     * 事件（家族形态；段卡素材地址 = 自有存储 url，不直连火山 24h 临时链接，规格故事 23）。
     */
    @Transactional
    public boolean publishVideoSceneSplitResult(
            com.bluewhale.worker.domain.dto.PublishVideoSceneSplitDto input) {
        Long jobIdLong = Long.parseLong(input.jobId());

        int guardAffected = jobMapper.publishMediaExtractGuard(
                jobIdLong, input.workerId(), input.fencingToken());
        if (guardAffected != 1) {
            log.warn("[video_scene_split] publishVideoSceneSplitResult 守卫未命中(stale/租约失效) jobId={} workerId={} token={}",
                    input.jobId(), input.workerId(), input.fencingToken());
            return false;
        }

        // 逐段建 Asset（段序按官方 segments[] 返回顺序；切片不改变分辨率 → 宽高取源近似）
        List<com.bluewhale.worker.domain.dto.PublishVideoSceneSplitDto.Segment> segments =
                input.segments();
        List<AssetEntity> assets = new java.util.ArrayList<>(segments.size());
        List<String> assetIds = new java.util.ArrayList<>(segments.size());
        // 契约 result 形态：{duration, segments[{segment_index, start_time, end_time, segment_asset_id}]}
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

        // 数字数组形态（completeJob 多产物 toJson(Long 列表) 同构；media_extract 单产物 "[id]" 等价）
        jobMapper.updateOutputAssetIds(jobIdLong,
                toJson(assetIds.stream().map(Long::parseLong).toList()));

        // 结果字段入库承载位：日志 payload 带契约 result 形态（段序/起止秒/段资产引用/总时长）
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
        // 每段一条 asset.created（家族形态）+ 一条 status_changed（payload 带 result 供前端扇出）
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
            Map<String, Object> resultPayload = new java.util.LinkedHashMap<>();
            resultPayload.put(
                    com.bluewhale.worker.domain.contract.VideoSceneSplitContract.RESULT_KEY_DURATION,
                    input.durationSec() != null ? input.durationSec() : 0);
            resultPayload.put(
                    com.bluewhale.worker.domain.contract.VideoSceneSplitContract.RESULT_KEY_SEGMENTS,
                    resultSegments);
            eventPublisher.publish(job.getProjectId(), "generation_job.status_changed",
                    "generation_job", job.getId().toString(), job.getVersion(), "job_" + job.getId(),
                    Map.of("job_id", job.getId().toString(),
                            "type", job.getType(),
                            "source", job.getSource(),
                            "status", job.getStatus(),
                            "progress", job.getProgress(),
                            "output_asset_ids", assetIds,
                            "result", resultPayload));
        }
        return true;
    }

    // ========== 内部工具 ==========

    private AssetEntity buildAsset(Long jobIdLong, String projectId, String userId, String type,
                                   String url, String storageKey, String mime, Long size, String md5,
                                   Integer width, Integer height, Integer durationMs) {
        AssetEntity asset = new AssetEntity();
        asset.setUserId(Long.parseLong(userId));
        asset.setProjectId(Long.parseLong(projectId));
        asset.setGenerationJobId(jobIdLong);
        asset.setType(type);
        asset.setUrl(url);
        asset.setStorageKey(storageKey);
        asset.setMime(mime);
        asset.setSize(size);
        // IKGS73：产物字节的 md5（来源 = TOS 上传出口，两个出口共用 ContentDigest）。
        // 降级路径（直存供应商 URL、手上没字节）传 null——工单显式接受的边界。
        asset.setMd5(md5);
        asset.setWidth(width);
        asset.setHeight(height);
        if (durationMs != null) {
            asset.setDurationMs(durationMs);
        }
        asset.setSource("generated");
        asset.setStatus("normal");
        LocalDateTime now = nowUtc();
        asset.setGmtCreate(now);
        asset.setGmtModified(now);
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
        logEntry.setOccurredAt(nowUtc());
        jobLogMapper.insert(logEntry);
    }

    private static LocalDateTime nowUtc() {
        return LocalDateTime.now(ZoneOffset.UTC);
    }

    private String toJson(Object obj) {
        try {
            return JSON_MAPPER.writeValueAsString(obj);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize to JSON", e);
        }
    }
}
