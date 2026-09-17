package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.dto.ClaimedImageEnhanceJobDto;
import com.bluewhale.worker.domain.dto.ClaimedImageOutpaintJobDto;
import com.bluewhale.worker.domain.dto.ClaimedMediaExtractJobDto;
import com.bluewhale.worker.domain.dto.ClaimedVideoJobDto;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.domain.entity.JobStatus;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 作业领取（刀④ 拆分自 JobStateMachineService 的 claim 族）。
 * <p>
 * 契约 §3.1 两段式 CAS（SELECT 候选 + UPDATE 独占）语义逐字移植：
 * - guard fail 一律静默返回空（不抛，stale worker 效应交给租约过期 + recovery）；
 * - by-id 路径无 .catch（DB 异常上抛，契约 §3.1 不对称）；
 * - 返回投影用**增后** fencing_token（candidate + 1）。
 * <p>
 * CAS 更新与媒体类型无关：audio/video/media_extract 各一专属方法（候选条件各异），
 * image 与 image_enhance / image_outpaint 共用参数化候选查询 findCandidateByTypeAndSources +
 * claimImageCas（各路径仅 type / source 白名单差异，租约时长由本类按媒体类型传入）。
 * 下一类媒体扩展触点：条件与既有路径仅 type/source 差异时复用参数化查询，
 * 否则新增 find*Candidate + claim*Cas + 投影 Dto（契约附录 C）。
 */
@Service
public class JobClaimService {

    private static final Logger log = LoggerFactory.getLogger(JobClaimService.class);

    /** 租约 120s（契约 §3.2 IMAGE_JOB_LEASE_SECONDS 默认；image 例外见下）。 */
    private static final int LEASE_SECONDS = 120;

    /** image 租约 420s（> NEW_API_IMAGE_TIMEOUT_MS 300s + 转存余量，防 recovery 孤儿重投双跑双扣）。 */
    private static final int IMAGE_LEASE_SECONDS = 420;

    /**
     * image_enhance 租约 420s（契约 §14 / IKGM9D）：同步 enhance 调用（读超时默认 300s）
     * + 结果图下载 + TOS 转存需在同一租约窗口内完成，否则 recovery 会把在跑任务判孤儿重投双跑
     * （image 的 420s 语义同款：租约必须 > 上游读超时 + 转存余量）。
     */
    private static final int IMAGE_ENHANCE_LEASE_SECONDS = 420;

    /**
     * image_outpaint 租约 420s（IKGOQW）：同步扩图调用（读超时默认 300s）+ 结果图下载 +
     * TOS 转存需在同一租约窗口内完成（与 image_enhance 的 420s 语义同款）。
     */
    private static final int IMAGE_OUTPAINT_LEASE_SECONDS = 420;

    /** image claim 的 source 白名单（claim-ops.ts:339 CLAIMABLE_JOB_SOURCES）。 */
    private static final List<String> IMAGE_CLAIM_SOURCES =
            List.of("bottom_dock", "plan_apply", "storyboard_preview");

    /** image_enhance claim 的单源白名单（契约 §14.1：唯一创建入口 = 画布图片卡工具条）。 */
    private static final List<String> IMAGE_ENHANCE_CLAIM_SOURCES =
            List.of("image_enhance");

    /** image_outpaint claim 的单源白名单（IKGOQW：唯一创建入口 = 画布图片卡「高清 ▾」菜单）。 */
    private static final List<String> IMAGE_OUTPAINT_CLAIM_SOURCES =
            List.of(com.bluewhale.worker.domain.entity.ImageOutpaintContract.SOURCE);

    /** image 租约可被 env 覆盖（对齐 TS IMAGE_JOB_LEASE_SECONDS）。 */
    private static int imageLeaseSeconds() {
        String raw = System.getenv("IMAGE_JOB_LEASE_SECONDS");
        if (raw != null) {
            try {
                int n = Integer.parseInt(raw);
                if (n > 0) return n;
            } catch (NumberFormatException e) {
                log.warn("IMAGE_JOB_LEASE_SECONDS 解析失败，使用默认值: {}", e.getMessage());
            }
        }
        return IMAGE_LEASE_SECONDS;
    }

    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();

    private final GenerationJobMapper jobMapper;

    public JobClaimService(GenerationJobMapper jobMapper) {
        this.jobMapper = jobMapper;
    }

    /**
     * 领取 media_extract 作业（claim-ops.ts:447-502）。
     */
    public Optional<ClaimedMediaExtractJobDto> claimMediaExtract(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = jobMapper.findMediaExtractCandidate(jobIdLong);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = nowUtc().plusSeconds(LEASE_SECONDS);
        int affected = jobMapper.claimMediaExtractCas(
                jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[media_extract] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    jobId, candidate.getFencingToken());
            return Optional.empty();
        }

        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());
        return Optional.of(new ClaimedMediaExtractJobDto(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                input != null ? input : Map.of(),
                workerId,
                postIncrementToken));
    }

    /**
     * 领取音频作业（claim-ops.ts:388-445 claimAudioJobById）。
     * 不套 source 白名单（IKCR78/IKC9EJ 教训对齐 media_extract）。
     */
    public Optional<ClaimedJobDto> claimAudioJobById(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = jobMapper.findAudioCandidate(jobIdLong);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = nowUtc().plusSeconds(LEASE_SECONDS);
        int affected = jobMapper.claimAudioCas(
                jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[audio] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    jobId, candidate.getFencingToken());
            return Optional.empty();
        }

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
                postIncrementToken));
    }

    /**
     * 领取图片作业（claim-ops.ts:331-386 claimImageJobById）。
     * 套 source 白名单；租约用 image 专用值（imageLeaseSeconds）。
     */
    public Optional<ClaimedJobDto> claimImageJobById(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = jobMapper.findCandidateByTypeAndSources(
                jobIdLong, "image", IMAGE_CLAIM_SOURCES);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = nowUtc().plusSeconds(imageLeaseSeconds());
        int affected = jobMapper.claimImageCas(
                jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[image] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    jobId, candidate.getFencingToken());
            return Optional.empty();
        }

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
                postIncrementToken));
    }

    /**
     * 领取视频作业（claim-ops.ts:261-330 claimVideoJobById）。
     * IKEA26：parentProviderTaskId = retry_of_job_id 关联父 job 的 provider_task_id。
     */
    public Optional<ClaimedVideoJobDto> claimVideoJobById(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = jobMapper.findVideoCandidate(jobIdLong);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = nowUtc().plusSeconds(LEASE_SECONDS);
        int affected = jobMapper.claimVideoCas(
                jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[video] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    jobId, candidate.getFencingToken());
            return Optional.empty();
        }

        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());

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
                parentProviderTaskId));
    }

    /**
     * 领取 image_enhance 作业（契约 §14 / IKGM9D，附录 C 触点④）。
     * <p>
     * 候选查询与 CAS 复用图片路径的参数化方法（仅 type / source 白名单差异）；
     * 租约用 image_enhance 专用 420s（> MediaKit 读超时 + 转存余量）。
     */
    public Optional<ClaimedImageEnhanceJobDto> claimImageEnhance(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = jobMapper.findCandidateByTypeAndSources(
                jobIdLong, "image_enhance", IMAGE_ENHANCE_CLAIM_SOURCES);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = nowUtc().plusSeconds(IMAGE_ENHANCE_LEASE_SECONDS);
        int affected = jobMapper.claimImageCas(
                jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[image_enhance] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    jobId, candidate.getFencingToken());
            return Optional.empty();
        }

        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());
        return Optional.of(new ClaimedImageEnhanceJobDto(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                input != null ? input : Map.of(),
                workerId,
                postIncrementToken));
    }

    /**
     * 领取 image_outpaint 作业（IKGOQW，附录 C 触点④）。
     * <p>
     * 候选查询与 CAS 复用图片路径的参数化方法（仅 type / source 白名单差异）；
     * 租约用 image_outpaint 专用 420s（> MediaKit 读超时 + 转存余量）。
     */
    public Optional<ClaimedImageOutpaintJobDto> claimImageOutpaint(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = jobMapper.findCandidateByTypeAndSources(
                jobIdLong,
                com.bluewhale.worker.domain.entity.ImageOutpaintContract.TAG,
                IMAGE_OUTPAINT_CLAIM_SOURCES);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = nowUtc().plusSeconds(IMAGE_OUTPAINT_LEASE_SECONDS);
        int affected = jobMapper.claimImageCas(
                jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[image_outpaint] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    jobId, candidate.getFencingToken());
            return Optional.empty();
        }

        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());
        return Optional.of(new ClaimedImageOutpaintJobDto(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                input != null ? input : Map.of(),
                workerId,
                postIncrementToken));
    }

    // ========== 内部工具 ==========

    private static LocalDateTime nowUtc() {
        return LocalDateTime.now(ZoneOffset.UTC);
    }

    Map<String, Object> parseJson(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return JSON_MAPPER.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            log.debug("parseJson 失败(非关键，字段降级为空): {}", e.getMessage());
            return null;
        }
    }
}
