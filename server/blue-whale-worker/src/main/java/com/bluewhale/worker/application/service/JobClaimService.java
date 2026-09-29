package com.bluewhale.worker.application.service;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.dto.ClaimedVideoJobDto;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
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
 * 候选查询分两类：**不套 source 白名单**的 findCandidateByTypeOnly（仅 type 参与匹配）与
 * **type + source 白名单**的 findCandidateByTypeAndSources。二者的分工是类型层面的——「不套
 * 白名单」由「调用了没有 source 参数的方法」表达，不是给参数化查询传空列表（IKHPK9 的坏 SQL）。
 * <p>
 * CAS 更新与媒体类型无关（WHERE 含 id / fencing_token / status，claimImageCas 与
 * claimMediaExtractCas 另含租约复核）：media_extract / audio / video
 * 用各自的 claimMediaExtractCas / claimAudioCas / claimVideoCas；**audio_trim、audio_speed
 * 与其余家族复用 claimImageCas**。租约时长由本类按媒体类型传入。
 * <p>
 * 下一类媒体扩展触点：条件与既有路径仅 type / source 差异时复用参数化查询；**不套 source
 * 白名单**时用 findCandidateByTypeOnly；条件另有差异时新增专属查询（必要时再加 claim*Cas）
 * + 投影 Dto（契约附录 C）。
 */
@Service
public class JobClaimService {

    private static final Logger log = LoggerFactory.getLogger(JobClaimService.class);

    /** audio 租约 120s（契约 §3.2 IMAGE_JOB_LEASE_SECONDS 默认；image/video 例外见下）。 */
    private static final int LEASE_SECONDS = 120;

    /** image 租约 420s（> NEW_API_IMAGE_TIMEOUT_MS 300s + 转存余量，防 recovery 孤儿重投双跑双扣）。 */
    private static final int IMAGE_LEASE_SECONDS = 420;

    /**
     * video 租约 300s（IKJ80I review 修复）：必须 > submit 最坏耗时 + 收尾余量。
     * <p>
     * 推导：NewApiVideoClient submit = connect 10s + read/write 120s（IKJ80M）≈130s 最坏；
     * 租约持有窗口 = claim → submit 返回 → markProviderSubmitted/failVideo 落库（成功或失败
     * 落库后租约即释放），旧值 120s 在 submit 进行中即过期 → RecoveryService（60s/轮，
     * processing + 租约过期即重投）判孤儿重投，第二个 worker 对同一 job 再 submit = 上游
     * 双跑双扣；且 fencing_token 已被新 claim 递增，原 worker 的终态与 IKJ80P 孤儿标记
     * 落库被 CAS 拒绝、恰在此窗口丢失。300s ≈ 2.3x 最坏 submit，覆盖收尾落库与
     * worker/DB 时钟偏差；同 image「租约 > 客户端超时 + 余量，防 recovery 孤儿重投双跑
     * 双扣」不变量（420/300 先例）。
     */
    private static final int VIDEO_LEASE_SECONDS = 300;

    /** image claim 的 source 白名单（claim-ops.ts:339 CLAIMABLE_JOB_SOURCES）。 */
    private static final List<String> IMAGE_CLAIM_SOURCES =
            List.of("bottom_dock", "plan_apply", "storyboard_preview");

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

    // ========== 工具族领取管道（IKIWP8 / ADR-0119，单一） ==========

    /**
     * 领取一个工具族作业——**全部 15 个工具家族共用的唯一管道**。
     * <p>
     * 本方法对具体家族**零知识**：家族差异全在 {@link ClaimSpec} 里（候选查询 / 租约秒 / CAS /
     * type），本类不 import 任何家族 Contract、不认识任何家族名。
     * <p>
     * 语义与迁移契约附录 C 的「claim 两段式 CAS」逐字一致，行为保持：
     * <ol>
     *   <li>查候选；null 直接返回空（不抛）。</li>
     *   <li>算租约到期时刻（{@code spec.leaseSeconds()}，image 家族每次读 env）。</li>
     *   <li>执行 CAS 第二段；受影响行数 0 = 守卫失败，记日志后返回空（stale worker 效应交给
     *       租约过期 + recovery，不抛）。</li>
     *   <li>投影——**对全部家族同构**（同一 candidate 行 → 同一组字段），因为
     *       {@link ClaimedJob} 是单一形态，没有按家族的投影分支。</li>
     * </ol>
     *
     * @param spec     该家族的领取规格（由各处理器构造并持有）
     * @param jobId    作业主键（字符串形态，管道内 parseLong）
     * @param workerId 当前 worker 标识，领取成功后写入 lease_owner
     * @return 领取成功返回投影；无候选 / CAS 未命中返回空
     */
    public Optional<ClaimedJob> claim(ClaimSpec spec, String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = spec.candidate(jobIdLong);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = WorkerClock.now().plusSeconds(spec.leaseSeconds());
        int affected = spec.claimCas(jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[{}] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    spec.type(), jobIdLong, candidate.getFencingToken());
            return Optional.empty();
        }

        return Optional.of(project(candidate, workerId));
    }

    /**
     * candidate 行 → {@link ClaimedJob} 的**唯一投影**。
     * <p>
     * 对全部工具家族同构。此前按家族各写一份投影、字段互有出入（media_extract 独有
     * createdAt/executionDeadlineAt；video_frame_interpolation 独有 cancelRequested；audio_speed
     * 漏了 parentProviderTaskId）——收敛后统一投影，处理器读不读某个字段由它自己决定。
     *
     * @param workerId 本次领取的 worker 标识（回填进投影，供处理器做后续状态推进）
     */
    private ClaimedJob project(GenerationJobEntity candidate, String workerId) {
        Map<String, Object> input = parseJson(candidate.getInput());
        return new ClaimedJob(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                input != null ? input : Map.of(),
                candidate.getType(),
                candidate.getProviderTaskId(),
                candidate.getCancelRequestedAt() != null,
                workerId,
                candidate.getFencingToken() + 1,
                candidate.getPollCount() != null ? candidate.getPollCount() : 0,
                candidate.getProgress() != null ? candidate.getProgress() : 0,
                candidate.getGmtCreate(),
                candidate.getExecutionDeadlineAt(),
                projectParentProviderTaskId(candidate));
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

        LocalDateTime leaseExpiresAt = WorkerClock.now().plusSeconds(LEASE_SECONDS);
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

        LocalDateTime leaseExpiresAt = WorkerClock.now().plusSeconds(imageLeaseSeconds());
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

        LocalDateTime leaseExpiresAt = WorkerClock.now().plusSeconds(VIDEO_LEASE_SECONDS);
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
     * IKI8GN 收敛：8 个 MediaKit 家族 claim 的父任务投影共用段——retry job（retry_of_job_id
     * 非空）二次查询父任务的 provider_task_id（视频 IKEA26 先例同款 mapper 方法，SQL 零
     * 新增）；非重试 job 返回 null，不查父任务。
     */
    private String projectParentProviderTaskId(GenerationJobEntity candidate) {
        if (candidate.getRetryOfJobId() == null) {
            return null;
        }
        return jobMapper.findProviderTaskId(candidate.getRetryOfJobId());
    }

    // ========== 内部工具 ==========
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
