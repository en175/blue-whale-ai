package com.bluewhale.worker.service;

import com.bluewhale.worker.persistence.*;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
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

    private static final int LEASE_SECONDS = 120; // 契约 §3.2：IMAGE_JOB_LEASE_SECONDS 默认 120s
    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();

    private final GenerationJobMapper jobMapper;
    private final AssetMapper assetMapper;
    private final GenerationJobLogMapper jobLogMapper;
    private final ProjectEventMapper projectEventMapper;

    public JobStateMachineService(
            GenerationJobMapper jobMapper,
            AssetMapper assetMapper,
            GenerationJobLogMapper jobLogMapper,
            ProjectEventMapper projectEventMapper
    ) {
        this.jobMapper = jobMapper;
        this.assetMapper = assetMapper;
        this.jobLogMapper = jobLogMapper;
        this.projectEventMapper = projectEventMapper;
    }

    /**
     * 领取 media_extract 作业（claim-ops.ts:447-502）。
     * <p>
     * 两段式：
     * 1. SELECT candidate WHERE id=? AND type='media_extract' AND is_delete=false
     *    AND next_action_at<=now AND (queued OR processing+孤儿)
     * 2. UPDATE CAS: status='processing', lease_owner=?, lease_expires_at=now+120s,
     *    last_polled_at=now, fencing_token+1, version+1
     * <p>
     * 返回投影用增后 token（candidate.fencing_token + 1）。
     * 0 行 → empty；DB 异常上抛（契约 §3.1 不对称：by-id 变体无 catch）。
     */
    public Optional<ClaimedMediaExtractJob> claimMediaExtract(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        // 1. 候选查询（claim-ops.ts:450-467）
        GenerationJob candidate = jobMapper.findMediaExtractCandidate(jobIdLong);
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

        return Optional.of(new ClaimedMediaExtractJob(
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
     * <p>
     * 钳制 0-99（Math.max(0, Math.min(99, Math.round(x)))）+ 续租。
     * CAS 守卫失败返回 false（契约 §3.1：guard fail 静默 false）。
     */
    public boolean updateMediaExtractProgress(UpdateMediaExtractProgressInput input) {
        Long jobIdLong = Long.parseLong(input.jobId());

        // 钳制 0-99（media-extract-ops.ts:36）
        int clampedProgress = Math.max(0, Math.min(99, Math.round((float) input.progress())));

        LocalDateTime leaseExpiresAt = LocalDateTime.now().plusSeconds(LEASE_SECONDS);
        int affected = jobMapper.updateMediaExtractProgress(
                jobIdLong,
                input.workerId(),
                input.fencingToken(),
                clampedProgress,
                leaseExpiresAt
        );

        return affected == 1;
    }

    /**
     * 发布 media_extract 结果（media-extract-ops.ts:45-135）。
     * <p>
     * 单事务原子操作：
     * 1. CAS 守卫 → status='succeeded', progress=100, 清租约
     * 2. 建 audio 资产行
     * 3. 更新 job output_asset_ids
     * 4. 建 generation_job_logs
     * 5. 建 project_events（asset.created + generation_job.status_changed）
     * <p>
     * 契约 §3.3：终态与结算同事务原子。免费工具：无结算逻辑。
     */
    @Transactional
    public boolean publishMediaExtractResult(PublishMediaExtractInput input) {
        Long jobIdLong = Long.parseLong(input.jobId());

        // 1. CAS 守卫（media-extract-ops.ts:47-63）
        int guardAffected = jobMapper.publishMediaExtractGuard(
                jobIdLong,
                input.workerId(),
                input.fencingToken()
        );
        if (guardAffected != 1) {
            return false;
        }

        // 2. 建 audio 资产行（media-extract-ops.ts:66-84）
        Asset asset = new Asset();
        asset.setUserId(Long.parseLong(input.userId()));
        asset.setProjectId(Long.parseLong(input.projectId()));
        asset.setGenerationJobId(jobIdLong);
        asset.setType("audio");
        asset.setUrl(input.url());
        asset.setStorageKey(input.storageKey());
        asset.setMime(input.mime());
        asset.setSize(input.size());
        // E 层合并后只有 duration_ms（毫秒）：ffmpeg 给秒浮点，×1000 取整（media-extract-ops.ts:77-80）
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

        // 3. 更新 job output_asset_ids（media-extract-ops.ts:85-88）
        String outputAssetIdsJson = "[" + asset.getId() + "]";
        jobMapper.updateOutputAssetIds(jobIdLong, outputAssetIdsJson);

        // 4. 建 generation_job_logs（media-extract-ops.ts:89-97）
        GenerationJobLog log = new GenerationJobLog();
        log.setGenerationJobId(jobIdLong);
        log.setEvent("succeeded");
        log.setStatus("succeeded");
        log.setMessage("音频已提取");
        log.setPayload(toJson(Map.of("asset_ids", List.of(asset.getId().toString()))));
        log.setOccurredAt(LocalDateTime.now());

        jobLogMapper.insert(log);

        // 5. 建 project_events（media-extract-ops.ts:99-133）
        GenerationJob job = jobMapper.selectById(jobIdLong);
        if (job != null && job.getProjectId() != null) {
            // asset.created 事件（media-extract-ops.ts:103-116）
            appendProjectEvent(
                    job.getProjectId(),
                    "asset.created",
                    "asset",
                    asset.getId().toString(),
                    asset.getVersion(),
                    "job_" + job.getId().toString(),
                    Map.of(
                            "asset_id", asset.getId().toString(),
                            "generation_job_id", job.getId().toString(),
                            "type", asset.getType(),
                            "access_url", asset.getUrl()
                    )
            );

            // generation_job.status_changed 事件（media-extract-ops.ts:117-132）
            appendProjectEvent(
                    job.getProjectId(),
                    "generation_job.status_changed",
                    "generation_job",
                    job.getId().toString(),
                    job.getVersion(),
                    "job_" + job.getId().toString(),
                    Map.of(
                            "job_id", job.getId().toString(),
                            "type", job.getType(),
                            "source", job.getSource(),
                            "status", job.getStatus(),
                            "progress", job.getProgress(),
                            "output_asset_ids", List.of(asset.getId().toString())
                    )
            );
        }

        return true;
    }

    /**
     * 失败 media_extract 作业（media-extract-ops.ts:138-192）。
     * <p>
     * 单事务原子操作：
     * 1. CAS 守卫 → status='failed', error={code,message,details?}, 清租约
     * 2. 建 generation_job_logs
     * 3. 建 project_events（generation_job.status_changed）
     * <p>
     * 契约 §3.3：免费工具，无预留释放（修正一）。
     */
    @Transactional
    public boolean failMediaExtractJob(FailMediaExtractInput input) {
        Long jobIdLong = Long.parseLong(input.jobId());

        // 1. CAS 守卫（media-extract-ops.ts:140-160）
        Map<String, Object> errorObj = new HashMap<>();
        errorObj.put("code", input.code());
        errorObj.put("message", input.message());
        if (input.details() != null) {
            errorObj.put("details", input.details());
        }
        String errorJson = toJson(errorObj);

        int guardAffected = jobMapper.failMediaExtractGuard(
                jobIdLong,
                input.workerId(),
                input.fencingToken(),
                errorJson
        );
        if (guardAffected != 1) {
            return false;
        }

        // 2. 建 generation_job_logs（media-extract-ops.ts:165-172）
        GenerationJobLog log = new GenerationJobLog();
        log.setGenerationJobId(jobIdLong);
        log.setEvent("failed");
        log.setStatus("failed");
        log.setMessage(input.code() + ": " + input.message());
        log.setOccurredAt(LocalDateTime.now());

        jobLogMapper.insert(log);

        // 3. 建 project_events（media-extract-ops.ts:173-189）
        GenerationJob job = jobMapper.selectById(jobIdLong);
        if (job != null && job.getProjectId() != null) {
            appendProjectEvent(
                    job.getProjectId(),
                    "generation_job.status_changed",
                    "generation_job",
                    job.getId().toString(),
                    job.getVersion(),
                    "job_" + job.getId().toString(),
                    Map.of(
                            "job_id", job.getId().toString(),
                            "type", job.getType(),
                            "source", job.getSource(),
                            "status", job.getStatus(),
                            "progress", job.getProgress(),
                            "error", Map.of("code", input.code(), "message", input.message())
                    )
            );
        }

        return true;
    }

    private void appendProjectEvent(
            Long projectId,
            String eventType,
            String aggregateType,
            String aggregateId,
            Integer aggregateVersion,
            String correlationId,
            Map<String, Object> payload
    ) {
        Long cursor = projectEventMapper.nextCursor(projectId);

        ProjectEvent event = new ProjectEvent();
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

    private Map<String, Object> parseJson(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return JSON_MAPPER.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (JsonProcessingException e) {
            return null;
        }
    }

    private String toJson(Object obj) {
        try {
            return JSON_MAPPER.writeValueAsString(obj);
        } catch (JsonProcessingException e) {
            throw new RuntimeException("Failed to serialize to JSON", e);
        }
    }
}
