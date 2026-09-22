package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.contract.AudioMixContract;
import com.bluewhale.worker.domain.contract.ImageOutpaintContract;
import com.bluewhale.worker.domain.contract.MediaExtractContract;
import com.bluewhale.worker.domain.contract.VideoEnhanceContract;
import com.bluewhale.worker.domain.contract.VideoSubtitleEraseContract;
import com.bluewhale.worker.domain.contract.VocalSplitContract;
import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.dto.ClaimedImageCutoutJobDto;
import com.bluewhale.worker.domain.dto.ClaimedImageEnhanceJobDto;
import com.bluewhale.worker.domain.dto.ClaimedImageEraseJobDto;
import com.bluewhale.worker.domain.dto.ClaimedImageOutpaintJobDto;
import com.bluewhale.worker.domain.dto.ClaimedMediaExtractJobDto;
import com.bluewhale.worker.domain.dto.ClaimedVideoJobDto;
import com.bluewhale.worker.domain.dto.ClaimedVideoFrameInterpolationJobDto;
import com.bluewhale.worker.domain.dto.ClaimedVideoSubtitleEraseJobDto;
import com.bluewhale.worker.domain.dto.ClaimedVocalSplitJobDto;
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
 * 候选查询分两类：**专属 type-only 查询**用于条件各异、或**不套 source 白名单**的四个家族
 * （findMediaExtractCandidate / findAudioCandidate / findVideoCandidate / findAudioTrimCandidate，
 * 各自硬编码 type、无 source 子句）；其余 9 个家族
 * （image / image_enhance / image_erase / image_cutout / image_outpaint /
 * video_subtitle_erase / video_enhance / vocal_split / video_scene_split）共用参数化候选查询
 * findCandidateByTypeAndSources（各路径仅 type / source 白名单差异，防逐字复制漂移）。
 * <p>
 * CAS 更新与媒体类型无关（WHERE 只含 id / fencing_token / status）：media_extract / audio / video
 * 用各自的 claimMediaExtractCas / claimAudioCas / claimVideoCas；**audio_trim 与上述 9 个家族
 * 复用 claimImageCas**。租约时长由本类按媒体类型传入。
 * <p>
 * 下一类媒体扩展触点：条件与既有路径仅 type/source 差异时复用参数化查询；**不套 source 白名单**
 * 或条件有别时，新增 find*Candidate（必要时再加 claim*Cas）+ 投影 Dto（契约附录 C）。注意
 * 「不套白名单」的正确表达是**专属查询**，不是给参数化查询传空列表——见
 * findCandidateByTypeAndSources javadoc 与 IKHPK9。
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

    /**
     * image_erase 租约 420s（契约 §15 / IKGOT6）：同步 erase 调用（读超时默认 300s）
     * + 结果图下载 + TOS 转存需在同一租约窗口内完成（image_enhance 的 420s 语义同款）。
     */
    private static final int IMAGE_ERASE_LEASE_SECONDS = 420;

    /** image_erase claim 的单源白名单（契约 §15.1：唯一创建入口 = 画布图片卡工具条「擦除」）。 */
    private static final List<String> IMAGE_ERASE_CLAIM_SOURCES =
            List.of("image_erase");

    /**
     * image_cutout 租约 420s（契约章节 docs/specs/2026-09-18-image-cutout-mediakit.md / IKGXM2）：
     * 同步抠图调用读超时默认 300s，保守取与擦除同款 420s（> 超时 + 结果图下载 + TOS 转存余量，
     * 防 recovery 孤儿重投双跑）。
     */
    private static final int IMAGE_CUTOUT_LEASE_SECONDS = 420;

    /** image_cutout claim 的单源白名单（唯一创建入口 = 画布图片卡工具条「高清 ▾ → 抠图」）。 */
    private static final List<String> IMAGE_CUTOUT_CLAIM_SOURCES =
            List.of("image_cutout");
    /** image_outpaint claim 的单源白名单（IKGOQW：唯一创建入口 = 画布图片卡「高清 ▾」菜单）。 */
    private static final List<String> IMAGE_OUTPAINT_CLAIM_SOURCES =
            List.of(ImageOutpaintContract.SOURCE);

    /**
     * video_subtitle_erase 租约 420s（迁移契约 §17 / IKGZ81）：轮询到点步是短查询，但 completed
     * 步要在同一租约窗口内完成结果视频下载（可达 200MB）+ TOS 转存——取同步 MediaKit 家族的
     * 420s（> 超时 + 下载转存余量，防 recovery 把在跑任务判孤儿重投）。
     */
    private static final int VIDEO_SUBTITLE_ERASE_LEASE_SECONDS = 420;

    /** video_subtitle_erase claim 的单源白名单（§17.1：唯一创建入口 = 画布视频卡工具条「智能去字幕」）。 */
    private static final List<String> VIDEO_SUBTITLE_ERASE_CLAIM_SOURCES =
            List.of(VideoSubtitleEraseContract.SOURCE);

    /**
     * video_enhance 租约 420s（IKH3VF，父规格 IKH3VB）：轮询到点步是短查询，但 completed 步
     * 要在同一租约窗口内完成增强结果视频下载（4K 产物体积大）+ TOS 转存——取 MediaKit 家族
     * 的 420s（> 超时 + 下载转存余量，防 recovery 把在跑任务判孤儿重投，去字幕同款语义）。
     */
    private static final int VIDEO_ENHANCE_LEASE_SECONDS = 420;

    /** video_enhance claim 的单源白名单（唯一创建入口 = 画布视频卡工具条「HD」单按钮）。 */
    private static final List<String> VIDEO_ENHANCE_CLAIM_SOURCES =
            List.of(VideoEnhanceContract.SOURCE);

    /**
     * video_scene_split 租约 420s（IKH8BP，父规格 IKH86V）：轮询到点步是短查询，但 completed
     * 步要在同一租约窗口内完成 N 段切片逐段下载（单段可达源视频体量）+ TOS 转存——取 MediaKit
     * 家族的 420s（> 超时 + 下载转存余量，防 recovery 把在跑任务判孤儿重投，去字幕/HD 同款语义）。
     */
    private static final int VIDEO_SCENE_SPLIT_LEASE_SECONDS = 420;

    /** video_scene_split claim 的单源白名单（唯一创建入口 = 画布视频卡工具条「场景切分」）。 */
    private static final List<String> VIDEO_SCENE_SPLIT_CLAIM_SOURCES =
            List.of(com.bluewhale.worker.domain.contract.VideoSceneSplitContract.SOURCE);

    /**
     * video_frame_interpolation 租约 420s（IKHLKJ，父需求 IKHLES）：轮询到点步是短查询，但
     * completed 步要在同一租约窗口内完成插帧结果视频下载（输出与源同规格，可达数 GB 体量）+
     * TOS 转存——取 MediaKit 家族的 420s（> 超时 + 下载转存余量，防 recovery 把在跑任务判
     * 孤儿重投，去字幕 / HD 高清 / 场景切分同款语义）。
     */
    private static final int VIDEO_FRAME_INTERPOLATION_LEASE_SECONDS = 420;

    /** video_frame_interpolation claim 的单源白名单（唯一创建入口 = 画布视频卡「高清 ▾」
     *  下拉第二项「插帧」；专属来源值口径，video_enhance 同款模式）。 */
    private static final List<String> VIDEO_FRAME_INTERPOLATION_CLAIM_SOURCES =
            List.of(com.bluewhale.worker.domain.contract.VideoFrameInterpolationContract.SOURCE);

    /**
     * video_matting 租约 420s（IKHK99，父规格 IKHJRC，契约 IKHK7F）：轮询到点步是短查询，但
     * completed 步要在同一租约窗口内完成抠像结果视频下载（输入可达 10GB 级）+ TOS 转存——
     * 取 MediaKit 家族的 420s（> 超时 + 下载转存余量，防 recovery 把在跑任务判孤儿重投；
     * 转存前另有 updateVideoMattingProgress 心跳续租推回窗口）。
     */
    private static final int VIDEO_MATTING_LEASE_SECONDS = 420;

    /** video_matting claim 的单源白名单（唯一创建入口 = 画布视频卡工具条「智能抠像 ▾」下拉）。 */
    private static final List<String> VIDEO_MATTING_CLAIM_SOURCES =
            List.of(com.bluewhale.worker.domain.contract.VideoMattingContract.SOURCE);

    /**
     * media_extract 租约 420s（迁移契约 §18 / IKH28W；火山异步链）：轮询到点步是短查询，但
     * completed 步要在同一租约窗口内完成结果音频下载（无损 wav 可达数百 MB）+ TOS 转存——
     * 取同步 MediaKit 家族的 420s（> 超时 + 下载转存余量，防 recovery 把在跑任务判孤儿重投）。
     */
    private static final int MEDIA_EXTRACT_LEASE_SECONDS = 420;

    /**
     * vocal_split 租约 420s（IKHA2J；火山异步链）：轮询到点步是短查询，但 completed 步要在
     * 同一租约窗口内完成 **2/3 条**结果音轨逐轨下载 + TOS 转存——取 MediaKit 家族的 420s
     * （> 超时 + 多轨下载转存余量，防 recovery 把在跑任务判孤儿重投，去字幕 / media_extract
     * 同款语义）。
     */
    private static final int VOCAL_SPLIT_LEASE_SECONDS = 420;

    /** vocal_split claim 的单源白名单（IKHA2J：唯一创建入口 = 画布媒体卡工具条「人声分离」；
     *  专属来源值口径，video_subtitle_erase / video_enhance 同款模式）。 */
    private static final List<String> VOCAL_SPLIT_CLAIM_SOURCES =
            List.of(VocalSplitContract.SOURCE);

    /**
     * audio_trim 租约 420s（IKHB6S，父单 IKHB08；火山异步链）：轮询到点步是短查询，但
     * completed 步要在同一租约窗口内完成结果音频下载（无损 wav 可达数百 MB）+ TOS 转存——
     * 取同步 MediaKit 家族的 420s（> 超时 + 下载转存余量，防 recovery 把在跑任务判孤儿重投，
     * media_extract 同款语义）。
     */
    private static final int AUDIO_TRIM_LEASE_SECONDS = 420;

    /**
     * audio_speed 租约 420s（IKHW5A，父单 IKHVYO；火山异步链）：轮询到点步是短查询，但
     * completed 步要在同一租约窗口内完成结果音频下载（默认 m4a 输出，无损源极端情况可达
     * 数百 MB）+ TOS 转存——取同步 MediaKit 家族的 420s（> 超时 + 下载转存余量，防 recovery
     * 把在跑任务判孤儿重投，audio_trim / media_extract 同款语义）。
     */
    private static final int AUDIO_SPEED_LEASE_SECONDS = 420;

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
     * 领取 media_extract 作业（claim-ops.ts:447-502；迁移契约 §18 / IKH28W 起投影扩
     * providerTaskId / pollCount / progress 三字段——火山异步链复用视频轮询骨架，分相判据
     * 与超限判定需要富投影，形态对齐 claimVideoSubtitleErase；候选查询本就 SELECT *
     * 全列，仅投影侧补字段，SQL 零改动）。
     */
    public Optional<ClaimedMediaExtractJobDto> claimMediaExtract(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);
        return claimPollingAudioJob(jobIdLong, workerId, MediaExtractContract.TAG,
                jobMapper.findMediaExtractCandidate(jobIdLong), jobMapper::claimMediaExtractCas);
    }

    /** audio_mix 仅选择 type/source 候选，领取生命周期与 media_extract 共用。 */
    public Optional<ClaimedMediaExtractJobDto> claimAudioMix(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);
        GenerationJobEntity candidate = jobMapper.findCandidateByTypeAndSources(
                jobIdLong, AudioMixContract.TAG, List.of(AudioMixContract.SOURCE));
        return claimPollingAudioJob(jobIdLong, workerId, AudioMixContract.TAG, candidate, jobMapper::claimImageCas);
    }

    @FunctionalInterface
    private interface PollingAudioCas {
        int claim(Long jobId, String workerId, LocalDateTime leaseExpiresAt,
                  Long fencingToken, String candidateStatus);
    }

    /** 单段轮询型音频任务的唯一 claim/CAS/投影生命周期。 */
    private Optional<ClaimedMediaExtractJobDto> claimPollingAudioJob(
            Long jobIdLong, String workerId, String type,
            GenerationJobEntity candidate, PollingAudioCas claimCas) {
        if (candidate == null) return Optional.empty();
        LocalDateTime leaseExpiresAt = WorkerClock.now().plusSeconds(MEDIA_EXTRACT_LEASE_SECONDS);
        int affected = claimCas.claim(jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[{}] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    type, jobIdLong, candidate.getFencingToken());
            return Optional.empty();
        }
        Map<String, Object> input = parseJson(candidate.getInput());
        return Optional.of(new ClaimedMediaExtractJobDto(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                input != null ? input : Map.of(),
                candidate.getProviderTaskId(), workerId, candidate.getFencingToken() + 1,
                candidate.getPollCount() != null ? candidate.getPollCount() : 0,
                candidate.getProgress() != null ? candidate.getProgress() : 0,
                candidate.getGmtCreate(), candidate.getExecutionDeadlineAt()));
    }

    /**
     * 领取 audio_trim 作业（IKHB6S，父单 IKHB08，附录 C 触点④）。
     * <p>
     * 候选查询用专属 {@code findAudioTrimCandidate}（type=audio_trim，**不套 source
     * 白名单**——audio / media_extract 同形态：契约票口径「任务来源值随接线票定死后补录」，
     * 专属来源值不在白名单，套了漏真卡任务，IKC9EJ 教训）。
     * <p>
     * IKHPK9：原先传 {@code List.of()} 给参数化 {@code findCandidateByTypeAndSources}
     * 表达「不过滤」，但 MyBatis 对空集合什么都不输出，渲染成
     * {@code ... AND source IN AND is_delete = false ...} 的坏 SQL，claim 恒失败、任务永久
     * 卡 queued。改为专属查询后空列表路径不再存在。
     * <p>
     * CAS 复用 {@code claimImageCas}（UPDATE WHERE 只含 id / fencing_token / status，
     * 与媒体类型无关）。投影带 providerTaskId / pollCount / progress（复用视频轮询骨架的
     * 分相判据与超限判定，media_extract 同款富投影）。
     */
    public Optional<com.bluewhale.worker.domain.dto.ClaimedAudioTrimJobDto> claimAudioTrim(
            String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = jobMapper.findAudioTrimCandidate(jobIdLong);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = WorkerClock.now().plusSeconds(AUDIO_TRIM_LEASE_SECONDS);
        int affected = jobMapper.claimImageCas(
                jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[audio_trim] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    jobId, candidate.getFencingToken());
            return Optional.empty();
        }

        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());
        return Optional.of(new com.bluewhale.worker.domain.dto.ClaimedAudioTrimJobDto(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                input != null ? input : Map.of(),
                candidate.getProviderTaskId(),
                workerId,
                postIncrementToken,
                candidate.getPollCount() != null ? candidate.getPollCount() : 0,
                candidate.getProgress() != null ? candidate.getProgress() : 0));
    }

    /**
     * 领取 audio_speed 作业（IKHW5A，父单 IKHVYO；claimAudioTrim 同款形态）。
     * <p>
     * 候选查询用专属 {@code findAudioSpeedCandidate}（type=audio_speed，**不套 source
     * 白名单**——audio_trim / media_extract 同形态：专属来源值不在白名单，套了漏真卡任务，
     * IKC9EJ 教训；专属查询是「不套白名单」在本仓的既有表达，IKHPK9）。
     * <p>
     * CAS 复用 {@code claimImageCas}（UPDATE WHERE 只含 id / fencing_token / status，
     * 与媒体类型无关）。投影带 providerTaskId / pollCount / progress（复用视频轮询骨架的
     * 分相判据与超限判定，media_extract / audio_trim 同款富投影）。
     */
    public Optional<com.bluewhale.worker.domain.dto.ClaimedAudioSpeedJobDto> claimAudioSpeed(
            String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = jobMapper.findAudioSpeedCandidate(jobIdLong);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = WorkerClock.now().plusSeconds(AUDIO_SPEED_LEASE_SECONDS);
        int affected = jobMapper.claimImageCas(
                jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[audio_speed] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    jobId, candidate.getFencingToken());
            return Optional.empty();
        }

        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());
        return Optional.of(new com.bluewhale.worker.domain.dto.ClaimedAudioSpeedJobDto(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                input != null ? input : Map.of(),
                candidate.getProviderTaskId(),
                workerId,
                postIncrementToken,
                candidate.getPollCount() != null ? candidate.getPollCount() : 0,
                candidate.getProgress() != null ? candidate.getProgress() : 0));
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

        LocalDateTime leaseExpiresAt = WorkerClock.now().plusSeconds(LEASE_SECONDS);
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

        LocalDateTime leaseExpiresAt = WorkerClock.now().plusSeconds(IMAGE_ENHANCE_LEASE_SECONDS);
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
     * 领取 image_erase 作业（契约 §15 / IKGOT6，附录 C 触点④）。
     * <p>
     * 候选查询与 CAS 复用图片路径的参数化方法（仅 type / source 白名单差异）；
     * 租录用 image_erase 专用 420s（> MediaKit 读超时 + 转存余量）。
     */
    public Optional<ClaimedImageEraseJobDto> claimImageErase(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = jobMapper.findCandidateByTypeAndSources(
                jobIdLong, "image_erase", IMAGE_ERASE_CLAIM_SOURCES);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = WorkerClock.now().plusSeconds(IMAGE_ERASE_LEASE_SECONDS);
        int affected = jobMapper.claimImageCas(
                jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[image_erase] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    jobId, candidate.getFencingToken());
            return Optional.empty();
        }

        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());
        return Optional.of(new ClaimedImageEraseJobDto(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                input != null ? input : Map.of(),
                workerId,
                postIncrementToken));
    }

    /**
     * 领取 image_cutout 作业（契约章节 docs/specs/2026-09-18-image-cutout-mediakit.md / IKGXM2）。
     * <p>
     * 候选查询与 CAS 复用图片路径的参数化方法（仅 type / source 白名单差异）；
     * 租约用 image_cutout 专用 420s（> MediaKit 读超时 + 转存余量）。
     */
    public Optional<ClaimedImageCutoutJobDto> claimImageCutout(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = jobMapper.findCandidateByTypeAndSources(
                jobIdLong, "image_cutout", IMAGE_CUTOUT_CLAIM_SOURCES);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = WorkerClock.now().plusSeconds(IMAGE_CUTOUT_LEASE_SECONDS);
        int affected = jobMapper.claimImageCas(
                jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[image_cutout] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    jobId, candidate.getFencingToken());
            return Optional.empty();
        }

        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());
        return Optional.of(new ClaimedImageCutoutJobDto(
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
                ImageOutpaintContract.TAG,
                IMAGE_OUTPAINT_CLAIM_SOURCES);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = WorkerClock.now().plusSeconds(IMAGE_OUTPAINT_LEASE_SECONDS);
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

    /**
     * 领取 video_subtitle_erase 作业（迁移契约 §17 / IKGZ81，附录 C 触点④）。
     * <p>
     * 候选查询与 CAS 复用图片路径的参数化方法（仅 type / source 白名单差异）；
     * 租约 420s（completed 步含结果视频下载 + TOS 转存，见常量注释）。
     * 投影带 providerTaskId / pollCount / progress（复用视频轮询骨架的分相判据与超限判定）。
     */
    public Optional<ClaimedVideoSubtitleEraseJobDto> claimVideoSubtitleErase(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = jobMapper.findCandidateByTypeAndSources(
                jobIdLong,
                VideoSubtitleEraseContract.TAG,
                VIDEO_SUBTITLE_ERASE_CLAIM_SOURCES);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = WorkerClock.now().plusSeconds(VIDEO_SUBTITLE_ERASE_LEASE_SECONDS);
        int affected = jobMapper.claimImageCas(
                jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[video_subtitle_erase] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    jobId, candidate.getFencingToken());
            return Optional.empty();
        }

        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());
        return Optional.of(new ClaimedVideoSubtitleEraseJobDto(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                input != null ? input : Map.of(),
                candidate.getProviderTaskId(),
                workerId,
                postIncrementToken,
                candidate.getPollCount() != null ? candidate.getPollCount() : 0,
                candidate.getProgress() != null ? candidate.getProgress() : 0));
    }

    /**
     * 领取 video_enhance 作业（IKH3VF，父规格 IKH3VB，附录 C 触点④）。
     * <p>
     * 候选查询与 CAS 复用图片路径的参数化方法（仅 type / source 白名单差异）；
     * 租约 420s（completed 步含结果视频下载 + TOS 转存，见常量注释）。
     * 投影带 providerTaskId / pollCount / progress（复用视频轮询骨架的分相判据与超限判定）。
     */
    public Optional<com.bluewhale.worker.domain.dto.ClaimedVideoEnhanceJobDto> claimVideoEnhance(
            String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = jobMapper.findCandidateByTypeAndSources(
                jobIdLong,
                VideoEnhanceContract.TAG,
                VIDEO_ENHANCE_CLAIM_SOURCES);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = WorkerClock.now().plusSeconds(VIDEO_ENHANCE_LEASE_SECONDS);
        int affected = jobMapper.claimImageCas(
                jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[video_enhance] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    jobId, candidate.getFencingToken());
            return Optional.empty();
        }

        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());
        return Optional.of(new com.bluewhale.worker.domain.dto.ClaimedVideoEnhanceJobDto(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                input != null ? input : Map.of(),
                candidate.getProviderTaskId(),
                workerId,
                postIncrementToken,
                candidate.getPollCount() != null ? candidate.getPollCount() : 0,
                candidate.getProgress() != null ? candidate.getProgress() : 0));
    }

    /**
     * 领取 vocal_split 作业（IKHA2J，附录 C 触点④）。
     * <p>
     * 候选查询与 CAS 复用图片路径的参数化方法（仅 type / source 白名单差异）；
     * 租约 420s（completed 步含 2/3 轨结果下载 + TOS 转存，见常量注释）。
     * 投影带 providerTaskId / pollCount / progress（复用视频轮询骨架的分相判据与超限判定）。
     */
    public Optional<ClaimedVocalSplitJobDto> claimVocalSplit(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = jobMapper.findCandidateByTypeAndSources(
                jobIdLong,
                VocalSplitContract.TAG,
                VOCAL_SPLIT_CLAIM_SOURCES);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = WorkerClock.now().plusSeconds(VOCAL_SPLIT_LEASE_SECONDS);
        int affected = jobMapper.claimImageCas(
                jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[vocal_split] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    jobId, candidate.getFencingToken());
            return Optional.empty();
        }

        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());
        return Optional.of(new ClaimedVocalSplitJobDto(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                input != null ? input : Map.of(),
                candidate.getProviderTaskId(),
                workerId,
                postIncrementToken,
                candidate.getPollCount() != null ? candidate.getPollCount() : 0,
                candidate.getProgress() != null ? candidate.getProgress() : 0));
    }

    /**
     * 领取 video_scene_split 作业（IKH8BP，父规格 IKH86V，附录 C 触点④）。
     * <p>
     * 候选查询与 CAS 复用图片路径的参数化方法（仅 type / source 白名单差异）；
     * 租约 420s（completed 步含 N 段切片逐段下载 + TOS 转存，见常量注释）。
     * 投影带 providerTaskId / pollCount / progress（复用视频轮询骨架的分相判据与超限判定）。
     */
    public Optional<com.bluewhale.worker.domain.dto.ClaimedVideoSceneSplitJobDto> claimVideoSceneSplit(
            String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = jobMapper.findCandidateByTypeAndSources(
                jobIdLong,
                com.bluewhale.worker.domain.contract.VideoSceneSplitContract.TAG,
                VIDEO_SCENE_SPLIT_CLAIM_SOURCES);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = WorkerClock.now().plusSeconds(VIDEO_SCENE_SPLIT_LEASE_SECONDS);
        int affected = jobMapper.claimImageCas(
                jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[video_scene_split] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    jobId, candidate.getFencingToken());
            return Optional.empty();
        }

        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());
        return Optional.of(new com.bluewhale.worker.domain.dto.ClaimedVideoSceneSplitJobDto(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                input != null ? input : Map.of(),
                candidate.getProviderTaskId(),
                workerId,
                postIncrementToken,
                candidate.getPollCount() != null ? candidate.getPollCount() : 0,
                candidate.getProgress() != null ? candidate.getProgress() : 0));
    }

    /**
     * 领取 video_matting 作业（IKHK99，父规格 IKHJRC，契约 IKHK7F，附录 C 触点④）。
     * <p>
     * 候选查询与 CAS 复用图片路径的参数化方法（仅 type / source 白名单差异）；
     * 租约 420s（completed 步含结果视频下载 + TOS 转存，见常量注释）。
     * 投影带 providerTaskId / pollCount / progress（复用视频轮询骨架的分相判据与超限判定）。
     */
    public Optional<com.bluewhale.worker.domain.dto.ClaimedVideoMattingJobDto> claimVideoMatting(
            String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = jobMapper.findCandidateByTypeAndSources(
                jobIdLong,
                com.bluewhale.worker.domain.contract.VideoMattingContract.TAG,
                VIDEO_MATTING_CLAIM_SOURCES);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = WorkerClock.now().plusSeconds(VIDEO_MATTING_LEASE_SECONDS);
        int affected = jobMapper.claimImageCas(
                jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[video_matting] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    jobId, candidate.getFencingToken());
            return Optional.empty();
        }

        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());
        return Optional.of(new com.bluewhale.worker.domain.dto.ClaimedVideoMattingJobDto(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                input != null ? input : Map.of(),
                candidate.getProviderTaskId(),
                workerId,
                postIncrementToken,
                candidate.getPollCount() != null ? candidate.getPollCount() : 0,
                candidate.getProgress() != null ? candidate.getProgress() : 0));
    }

    /**
     * 领取 video_frame_interpolation 作业（IKHLKJ，父需求 IKHLES，附录 C 触点④）。
     * <p>
     * 候选查询与 CAS 复用图片路径的参数化方法（仅 type / source 白名单差异）；
     * 租约 420s（completed 步含结果视频下载 + TOS 转存，见常量注释）。
     * 投影带 providerTaskId / pollCount / progress（复用视频轮询骨架的分相判据与超限判定）
     * 与 cancelRequested（软取消入口对本类型生效，处理器据它落 cancelled 终态）。
     */
    public Optional<ClaimedVideoFrameInterpolationJobDto> claimVideoFrameInterpolation(
            String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = jobMapper.findCandidateByTypeAndSources(
                jobIdLong,
                com.bluewhale.worker.domain.contract.VideoFrameInterpolationContract.TAG,
                VIDEO_FRAME_INTERPOLATION_CLAIM_SOURCES);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = WorkerClock.now()
                .plusSeconds(VIDEO_FRAME_INTERPOLATION_LEASE_SECONDS);
        int affected = jobMapper.claimImageCas(
                jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[video_frame_interpolation] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    jobId, candidate.getFencingToken());
            return Optional.empty();
        }

        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());
        return Optional.of(new ClaimedVideoFrameInterpolationJobDto(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                input != null ? input : Map.of(),
                candidate.getProviderTaskId(),
                candidate.getCancelRequestedAt() != null,
                workerId,
                postIncrementToken,
                candidate.getPollCount() != null ? candidate.getPollCount() : 0,
                candidate.getProgress() != null ? candidate.getProgress() : 0));
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
