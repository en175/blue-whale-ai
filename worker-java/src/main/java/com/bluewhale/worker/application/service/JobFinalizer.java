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
 * <p>
 * IKHKMJ 同构收敛：单槽免费工具族 publish 收敛到 {@link #publishSingleAssetResult} 模板
 * （公开方法 = 填参数薄委托），轮询型 fail 收敛到 {@link #failPollingToolJob}；新家族
 * 接入不再整段复制骨架。
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
     * <p>
     * 单槽免费工具形态，走 {@link #publishSingleAssetResult} 模板；本方法仅填家族参数
     * （type='audio'、duration 秒入 duration_ms、日志文案）。
     */
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

    /** 音频混合成功：单槽免费音频资产；官方 result.duration 秒转毫秒。 */
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

    /**
     * 音视频合成成功：单槽免费视频资产（IKIHPJ，迁移契约 §20.4）。
     * <p>
     * 秒→毫秒换算在此收口：{@code duration_ms = round(result.duration × 1000)}；宽高由
     * {@code result.resolution}（"WxH"）解析。时长/分辨率缺失回落源视频资产（去字幕先例）；
     * 结果资产命名 = 源视频资产名去扩展名 + "(音视频合成).mp4"（ASCII 圆括号，卡片回填取资产名）。
     */
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

    /** 结果资产命名（IKIHPJ 拍板⑤）：源视频资产名去扩展名 + "(音视频合成).mp4"；源名空白回落基名「视频」。 */
    private static String composeAudioVideoMuxResultName(String sourceName) {
        String base = sourceName == null ? "" : sourceName.trim();
        int dot = base.lastIndexOf('.');
        if (dot > 0) base = base.substring(0, dot);
        if (base.isEmpty()) base = "视频";
        return base + "(音视频合成).mp4";
    }

    /**
     * 核实音视频合成转存对象的权威发布状态（IKIN03）：发布调用抛异常或守卫拒绝时，本地
     * 返回值不能单边决定删除，先查库。判据 = assets 存在 generation_job_id + storage_key
     * 精确匹配行（发布事务原子提交，Asset 行即「已发布」的权威记录——事务提交后才断网的
     * 场景查询仍命中）；GenerationJob 终态一并读取入日志（可观测性，非判据：接管者/重试
     * 的新对象 key 含各自随机 uuid，不会与本查询交叉）。
     */
    public boolean hasPublishedAsset(String jobId, String storageKey) {
        Long jobIdLong = Long.parseLong(jobId);
        Long assetId = assetMapper.findReferencingAssetId(jobIdLong, storageKey);
        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        log.info("[audio_video_mux] 转存对象权威状态核实 jobId={} storageKey={} referencedAssetId={} jobStatus={}",
                jobId, storageKey, assetId, job != null ? job.getStatus() : null);
        return assetId != null;
    }

    /**
     * 确认「可能发布该对象键的事务」是否仍未结束（IKIN8Z）：发布事务的第一条语句是对
     * generation_jobs 行的 {@code publishResultGuard} CAS UPDATE，行 X 锁自那一刻起持有至
     * 提交/回滚完成——以 NOWAIT 探测该行锁即可判断事务是否仍在服务端进行（如 commit 窗口
     * 断连后的未决事务，对并发 Asset 查询在 REPEATABLE READ 下不可见）。
     * <p>
     * 锁被占用返回 true（保守视为可能有事务即将提交该键——占用者也可能是其他守卫写，如
     * 接管者 claim / 续租，无法区分时不删除即正确取舍）；锁空闲返回 false = 可能发布该键
     * 的事务已结束，随后的 {@link #hasPublishedAsset} 查询即权威结论（提交则命中 Asset 行，
     * 回滚/未插入则查无）。行不存在同样返回 false（无从发布该键）。
     * <p>
     * 仅锁冲突（MySQL 3572/1205，识别经 cause 链，兼容 MyBatis 直抛与 Spring 翻译两种包装）
     * 转为 true；其余异常原样上抛——数据库不可用 ≠ 事务进行中，由调用方按「暂不可确认」
     * 保守保留对象并留待处理记录。
     */
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

    // ========== audio_trim 直通（IKHB6S，父单 IKHB08；publish/fail 守卫复用
    //            publishResultGuard / failMediaExtractGuard——两 SQL 均无 type 过滤，
    //            语义 = 单槽免费工具轮询型任务终态收口） ==========

    /**
     * 发布 audio_trim 结果（IKHB6S）。
     * <p>
     * 同 publishMediaExtractResult 形态（单槽单 asset、双事件），差异仅文案；Asset
     * type='audio'、duration_ms 取官方 result.duration 秒换算（截取片段时长 ≠ 源全长，
     * **不做源时长回落**——media_extract 的回落口径建立在「整轨提取 ≈ 源时长」之上，
     * 截取语义不成立，官方值缺失即 null，ADR-0111「产物时长以火山返回 duration 写回
     * 服务端权威时长」）。
     */
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

    /**
     * 失败 audio_trim 作业（IKHB6S；failMediaExtractJob 同款守卫——轮询型任务失败多清
     * next_poll_at，details.raw 透传原始原因）。
     */
    @Transactional
    public boolean failAudioTrimJob(
            com.bluewhale.worker.domain.dto.FailAudioTrimDto input) {
        return failPollingToolJob("[audio_trim] failAudioTrimJob",
                input.jobId(), input.code(), input.message(), input.details(),
                input.workerId(), input.fencingToken());
    }

    // ========== audio_speed 直通（IKHW5A，父单 IKHVYO；publish/fail 守卫复用
    //            publishSingleAssetResult / failPollingToolJob——两 SQL 均无 type 过滤，
    //            语义 = 单槽免费工具轮询型任务终态收口，audio_trim 同款） ==========

    /**
     * 发布 audio_speed 结果（IKHW5A）。
     * <p>
     * 同 publishAudioTrimResult 形态（单槽单 asset、双事件），差异仅文案；Asset
     * type='audio'、duration_ms 取官方 result.duration 秒换算（调速产物时长 = 源时长/speed
     * ≠ 源时长，**不做源时长回落**——官方值缺失即 null，父单实现决策 1「产物时长以火山
     * 返回 duration 写回服务端权威时长」，ADR-0113 同口径）。
     */
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

    /**
     * 失败 audio_speed 作业（IKHW5A；failAudioTrimJob 同款守卫——轮询型任务失败多清
     * next_poll_at，details.raw 透传原始原因）。
     */
    @Transactional
    public boolean failAudioSpeedJob(
            com.bluewhale.worker.domain.dto.FailAudioSpeedDto input) {
        return failPollingToolJob("[audio_speed] failAudioSpeedJob",
                input.jobId(), input.code(), input.message(), input.details(),
                input.workerId(), input.fencingToken());
    }

    /**
     * 发布 image_enhance 结果（契约 §14.5 / IKGM9D，附录 C 触点⑤）。
     * <p>
     * 免费工具无结算联动，同 publishMediaExtractResult 形态（单槽单 asset、双事件），
     * 差异 = Asset type='image' / source='generated' 且带宽高（结果图 ImageIO 解析，
     * 解析失败静默 null，契约 §8 等价标准）。守卫复用 publishResultGuard / updateOutputAssetIds
     * （两 SQL 均无 type 过滤，语义 = 单槽免费工具终态收口）。
     */
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

    /**
     * 发布 image_erase 结果（契约 §15.5 / IKGOT6，附录 C 触点⑤）。
     * <p>
     * 免费工具无结算联动，同 publishImageEnhanceResult 形态（单槽单 asset、双事件），
     * Asset type='image' / source='generated' 且带宽高（结果图 ImageIO 解析，
     * 解析失败静默 null，契约 §8 等价标准）。守卫复用 publishResultGuard / updateOutputAssetIds
     * （两 SQL 均无 type 过滤，语义 = 单槽免费工具终态收口）。
     */
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

    /**
     * 发布 image_cutout 结果（契约章节 docs/specs/2026-09-18-image-cutout-mediakit.md / IKGXM2）。
     * <p>
     * 免费工具无结算联动，同 publishImageEraseResult 形态（单槽单 asset、双事件），
     * Asset type='image' / source='generated' 且带宽高（优先取官方响应 result.image_width/
     * image_height，缺失时结果图 ImageIO 解析兜底，解析失败静默 null，契约 §8 等价标准）。
     * 守卫复用 publishResultGuard / updateOutputAssetIds（两 SQL 均无 type 过滤，
     * 语义 = 单槽免费工具终态收口）。
     */
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
        return failPollingToolJob("[media_extract] failMediaExtractJob",
                jobId, errorCode, errorMessage, details, workerId, fencingToken);
    }

    /**
     * 发布 image_outpaint 结果（IKGOQW）。
     * <p>
     * 与 publishImageEnhanceResult 同构（免费工具无结算联动、单槽单 asset、双事件），
     * Asset type='image' / source='generated'。守卫复用 publishResultGuard /
     * updateOutputAssetIds（两 SQL 均无 type 过滤，语义 = 单槽免费工具终态收口）。
     */
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

    /**
     * 发布 vocal_split（人声背景分离）结果（IKHA2J，附录 C 触点⑤）。
     * <p>
     * 与单轨先例（{@link #publishMediaExtractResult}）的契约差异 = 多轨：scene 二分法两轨 /
     * 三分法三轨，按 {@link com.bluewhale.worker.domain.dto.PublishVocalSplitDto#tracks()}
     * 轨序（契约 SCENE_TRACKS，voice 恒首轨）逐轨 insert 音频 Asset，output_asset_ids 按轨序
     * 拼 JSON 数组（消费方按下标与轨类型双通道对位）。终态日志 payload 落契约
     * VocalSplitTrackResult 结构的轨数组（track_type / asset_id / url / duration）——这是
     * 轨类型在 DB 侧的唯一承载位（assets 无轨类型列，getStatus 轨投影经 output_asset_ids
     * 顺序 + input.scene 轨序组装）。守卫复用 publishResultGuard / updateOutputAssetIds
     * （两 SQL 均无 type 过滤，语义 = 免费工具终态收口）；每轨一条 asset.created +
     * 一条 status_changed（output_asset_ids = 全部轨资产，project_id 守卫内，extract 同款）。
     */
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

        // 逐轨建资产（type=audio / source='generated'；轨序 = 传入顺序 = 契约 SCENE_TRACKS）
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
            // 契约 VocalSplitTrackResult 逐字段（轨类型 + 资产 id + url + 时长秒）
            Map<String, Object> trackResult = new java.util.LinkedHashMap<>();
            trackResult.put("track_type", track.trackType());
            trackResult.put("asset_id", asset.getId().toString());
            trackResult.put("url", asset.getUrl());
            trackResult.put("duration", track.durationSec());
            trackResults.add(trackResult);
        }

        // output_asset_ids 按轨序拼 JSON 数组（"[id1,id2(,id3)]"——多轨形态，与单轨同 SQL）
        jobMapper.updateOutputAssetIds(jobIdLong, "[" + String.join(",", assetIds) + "]");

        // 轨数组回填终态日志 payload（结果字段入库的承载位，video_enhance 的 resolution/fps 同款）
        insertLog(jobIdLong, JobStatusEnum.SUCCEEDED, "人声背景分离完成",
                Map.of("asset_ids", assetIds, "tracks", trackResults));

        GenerationJobEntity job = jobMapper.selectById(jobIdLong);
        if (job != null && job.getProjectId() != null) {
            // 每轨一条 asset.created（前端逐轨扇出建卡的事件面）
            for (AssetEntity asset : assets) {
                eventPublisher.publish(job.getProjectId(), "asset.created", "asset",
                        asset.getId().toString(), asset.getVersion(), "job_" + job.getId(),
                        Map.of("asset_id", asset.getId().toString(),
                                "generation_job_id", job.getId().toString(),
                                "type", asset.getType(),
                                "access_url", asset.getUrl()));
            }
            eventPublisher.publish(job.getProjectId(), "generation_job.status_changed",
                    "generation_job", job.getId().toString(), job.getVersion(), "job_" + job.getId(),
                    Map.of("job_id", job.getId().toString(),
                            "type", job.getType(),
                            "source", job.getSource(),
                            "status", job.getStatus(),
                            "progress", job.getProgress(),
                            "output_asset_ids", assetIds));
        }
        return true;
    }

    /**
     * 发布 video_subtitle_erase 结果（迁移契约 §17.5 / IKGZ81，附录 C 触点⑤）。
     * <p>
     * 免费工具无结算联动，同 publishImageEraseResult 形态（单槽单 asset、双事件），
     * 差异 = Asset type='video' 且带宽 durationSec（官方 result.duration 秒；宽高为源
     * Asset 近似值，官方不返回输出元数据，§8 静默 null 等价标准）。守卫复用
     * publishResultGuard / updateOutputAssetIds（两 SQL 均无 type 过滤，
     * 语义 = 单槽免费工具终态收口）。
     */
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

    /**
     * 发布 video_enhance 结果（IKH3VF，父规格 IKH3VB，附录 C 触点⑤）。
     * <p>
     * 免费工具无结算联动，同 publishVideoSubtitleEraseResult 形态（单槽单 asset、双事件），
     * 差异 = 宽高由 processor 按目标分辨率档位推导（官方不返回输出像素）、带宽
     * resolution / fps——assets 无对应列，两值落终态日志 payload（结果字段入库的承载位）。
     * 守卫复用 publishResultGuard / updateOutputAssetIds（两 SQL 均无 type 过滤，
     * 语义 = 单槽免费工具终态收口）。
     */
    @Transactional
    public boolean publishVideoEnhanceResult(
            com.bluewhale.worker.domain.dto.PublishVideoEnhanceDto input) {
        // 结果字段入库：assets 承载 url/宽高/时长；resolution 档位与 fps（assets 无列）落日志
        // payload（结果字段入库的承载位），经模板 extraLogPayload 合并（键序 resolution→fps）。
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

    /**
     * 发布 video_matting 结果（IKHK99，父规格 IKHJRC，契约 IKHK7F，附录 C 触点⑤）。
     * <p>
     * 免费工具无结算联动，同 {@link #publishVideoEnhanceResult} 形态（单槽单 asset、双事件，
     * 走 {@link #publishSingleAssetResult} 模板）；差异 = **契约 result 三键落终态日志 payload**
     * （键序 video_url→resolution→duration，video_enhance 的 resolution/fps 先例）：
     * video_url（转存自有存储后的公开读地址——官方 24h 临时链接不落库）/ resolution / duration
     * 按 VideoMattingContract.RESULT_KEY_* 组装为结果字段承载位（当前前端走 asset 通道回填
     * 成品卡，本组键为契约承载位，见 backend/libs/contracts/video-matting.ts 注释）。
     */
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

    /**
     * 发布 video_scene_split 结果（IKH8BP，父规格 IKH86V，附录 C 触点⑤）。
     * <p>
     * 免费工具无结算联动，同 {@link #publishVideoEnhanceResult} 形态（守卫复用
     * publishResultGuard），差异 = **一对多**：N 段切片逐段建 Asset（type='video' /
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

        int guardAffected = jobMapper.publishResultGuard(
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

    /**
     * 发布 video_frame_interpolation 结果（IKHLKJ，父需求 IKHLES，附录 C 触点⑤）。
     * <p>
     * 免费工具无结算联动，走 {@link #publishSingleAssetResult} 模板（单槽单 asset、双事件），
     * 本方法仅填家族参数（tag / asset type / 时长换算 / 日志文案 / 附加日志键）。差异 =
     * **宽高取源近似值**：官方明示「插帧不改变分辨率，跟随原片」，故无档位推导（HD 的档位
     * 短边表不复制，插帧无档位表、也不设门槛）。结果四键中 duration / resolution / fps 落
     * 终态日志 payload（assets 无对应列），键名引用冻结契约
     * {@link VideoFrameInterpolationContract#RESULT_KEY_DURATION} 等——fps 只作结果契约字段，
     * 不新增卡片 / 资产 fps 元数据链（ADR-0113）。
     * 守卫由模板复用 publishResultGuard / updateOutputAssetIds（两 SQL 均无 type 过滤，
     * 语义 = 单槽免费工具终态收口；守卫要求 status='processing'，故已取消任务的迟到结果
     * 过不了守卫，卡片不会被复活为成功）。
     */
    @Transactional
    public boolean publishVideoFrameInterpolationResult(
            com.bluewhale.worker.domain.dto.PublishVideoFrameInterpolationDto input) {
        // 结果字段入库承载位：assets 承载 url/宽高/时长；官方 result 的 duration / resolution /
        // fps 落日志 payload（键名 = 契约 RESULT_KEYS，assets 无对应列），经模板 extraLogPayload
        // 合并（键序 duration→resolution→fps）。
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

    // ========== 家族模板（IKHKMJ 同构收敛） ==========
    // 单槽免费工具 publish（8 家族）与轮询型免费工具 fail（media_extract / audio_trim，
    // 及复用 failMediaExtractJob 守卫的 vocal_split）的骨架逐字同构，差异全为数据参数。
    // 新免费工具家族接入 = publish DTO + 下方模板薄委托（填 tag / asset type / 时长换算 /
    // 日志文案 / 附加日志键）；失败侧零新增（按骨架复用 failJob / failVideoJob /
    // failMediaExtractJob，守卫 SQL 无 type 过滤）。多槽/带槽语义（completeJob / failJob /
    // failVideoJob / publishVideoResult / publishVocalSplitResult /
    // publishVideoSceneSplitResult）不走模板——槽位与摘要同步的差异实质大于同构。

    /**
     * 单槽免费工具发布模板：守卫 CAS → 建 asset → 回写 output_asset_ids → 终态日志 →
     * project_id 守卫内双事件（asset.created + status_changed）。
     * <p>
     * 守卫复用 publishResultGuard / updateOutputAssetIds（两 SQL 均无 type 过滤，
     * 语义 = 单槽免费工具终态收口）。两个事件都在 job.project_id 守卫内
     * （media-extract-ops.ts:102 逐字：asset.created 与 status_changed 同处
     * {@code if (job.project_id != null)}；与通用 createAsset 的恒发不同）。
     * <p>
     * 日志 payload = asset_ids + extraLogPayload（video_enhance 的 resolution/fps 先例，
     * 键序由调用方构造 extraLogPayload 时决定；null = 无附加键）。
     */
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
     * 单槽免费工具发布模板的参数束（家族间唯一差异即此束的字段值，非 per-family 配置）。
     */
    private record SingleAssetPublish(
            /** 守卫 warn 日志前缀（"[family] methodName"，逐字保留家族可观测性）。 */
            String logTag,
            String jobId, String projectId, String userId, String workerId, long fencingToken,
            /** Asset type：audio / image / video。 */
            String assetType,
            String url, String storageKey, String mime, Long size, String md5,
            Integer width, Integer height, Integer durationMs,
            String successMessage,
            /** 终态日志附加键值（可 null）；结果字段入库的承载位先例。 */
            Map<String, Object> extraLogPayload,
            /** 结果资产名（可 null = 不命名）；音视频合成按迁移契约 §20.4 落「视频名(音视频合成).mp4」。 */
            String name
    ) {
        /** 无命名家族的旧形构造（name=null）：既有注册点零改动。 */
        SingleAssetPublish(String logTag, String jobId, String projectId, String userId, String workerId,
                           long fencingToken, String assetType, String url, String storageKey, String mime,
                           Long size, String md5, Integer width, Integer height, Integer durationMs,
                           String successMessage, Map<String, Object> extraLogPayload) {
            this(logTag, jobId, projectId, userId, workerId, fencingToken, assetType, url, storageKey, mime,
                    size, md5, width, height, durationMs, successMessage, extraLogPayload, null);
        }
    }

    /**
     * 轮询型免费工具失败模板：failMediaExtractGuard（SET 清 next_action_at + next_poll_at）
     * → 终态日志 → project_id 守卫内单条 status_changed。无槽位语义、无摘要同步，
     * details.raw 透传原始原因。守卫 SQL 无 type 过滤，免费工具族跨家族复用。
     */
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

    // ========== 内部工具 ==========

    /** 旧形签名（不命名家族）：name=null 委托，既有调用点零改动。 */
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
        LocalDateTime now = WorkerClock.now();
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
