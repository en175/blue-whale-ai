package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishVideoSceneSplitDto;
import com.bluewhale.worker.domain.dto.UpdateVideoSceneSplitProgressDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.GenerationErrorDetailContract;
import com.bluewhale.worker.domain.contract.VideoSceneSplitContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoSceneSplitError;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.common.http.NewApiHttpSupport;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSegmentScenesClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSegmentScenesClient.SceneSplitTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSegmentScenesClient.SegmentObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

@Component
public class VideoSceneSplitJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(VideoSceneSplitJobProcessor.class);

    /** §5 分类信号白名单：这些既有码直接投影，其余全部归并 video_scene_split_failed(1046)。 */
    private static final Set<String> PRESERVED_ERROR_CODES = Set.of(
            GenerationError.ERROR_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    /** 轮询步调 5s（去字幕 SUBTITLE_ERASE_POLL_INTERVAL_MS / 视频骨架同值）。 */
    public static final long SCENE_SPLIT_POLL_INTERVAL_MS = 5_000;

    /**
     * 轮询上限 720 次 ≈ 60 分钟（去字幕 MAX_SUBTITLE_ERASE_POLLS 同值）：切分本身是
     * 分析型任务，耗时上界低于重渲染类，60 分钟窗口覆盖产品上限（2 小时片）内最长任务。
     */
    public static final int MAX_SCENE_SPLIT_POLLS = 720;

    /** 领取规格（IKIWP8 / ADR-0119）。 */
    private static final int LEASE_SECONDS = 420;
    private static final List<String> CLAIM_SOURCES = List.of(VideoSceneSplitContract.SOURCE);

    private final JobStateMachineService stateMachine;
    private final JobFinalizer finalizer;
    private final JobClaimService claimService;
    private final ClaimSpec claimSpec;
    private final AssetSourceService assetSource;
    private final UpstreamCredential upstreamCredential;
    private final NewApiMediaKitSegmentScenesClient segmentScenesClient;
    private final TosVideoMediaRelay mediaRelay;
    private final GenerationMessageProducer producer;
    private final String workerId;

    public VideoSceneSplitJobProcessor(
            JobStateMachineService stateMachine,
            JobClaimService claimService,
            GenerationJobMapper jobMapper,
            JobFinalizer finalizer,
            AssetSourceService assetSource,
            UpstreamCredential upstreamCredential,
            NewApiMediaKitSegmentScenesClient segmentScenesClient,
            TosVideoMediaRelay mediaRelay,
            @Qualifier("videoSceneSplitMessageProducer")
            GenerationMessageProducer producer
    ) {
        this.stateMachine = stateMachine;
        this.finalizer = finalizer;
        this.claimService = claimService;
        this.claimSpec = ClaimSpec.bySources(
                VideoSceneSplitContract.TAG, LEASE_SECONDS, CLAIM_SOURCES, jobMapper);
        this.assetSource = assetSource;
        this.upstreamCredential = upstreamCredential;
        this.segmentScenesClient = segmentScenesClient;
        this.mediaRelay = mediaRelay;
        this.producer = producer;
        this.workerId = "scenesplit-" + hostname() + "-" + ProcessHandle.current().pid();
    }

    @Override
    public String tag() {
        return VideoSceneSplitContract.TAG;
    }

    /**
     * 本家族的领取规格：供「一个处理器 ↔ 一份规格」一致性断言枚举（IKIWP8 / ADR-0119）。
     */
    @Override
    public Optional<ClaimSpec> claimSpec() {
        return Optional.of(claimSpec);
    }

    /**
     * 处理一个 video_scene_split step。
     * <p>
     * claim 在 try 外（视频骨架同构：DB 异常上抛 → consumer 不 ack → 重投）；
     * 业务失败一律落终态 failed（无自动重试）。
     */
    @Override
    public void handle(String jobId) {
        Optional<ClaimedJob> claimOpt;
        try {
            claimOpt = claimService.claim(claimSpec, jobId, workerId);
        } catch (Exception error) {
            log.error("[video_scene_split] claim 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error; // 保持不 ack → RocketMQ 重投
        }
        if (claimOpt.isEmpty()) return; // 无可认领 / 重复唤醒

        ClaimedJob claim = claimOpt.get();
        log.info("[video_scene_split] 已领取 jobId={} token={} providerTaskId={} pollCount={}",
                claim.id(), claim.fencingToken(), claim.providerTaskId(), claim.pollCount());

        try {
            runStep(claim);
        } catch (Exception e) {
            String code = resolveFailCode(e);
            Integer httpStatus = NewApiHttpSupport.upstreamHttpStatus(e);
            String message = e.getMessage() != null ? e.getMessage() : "场景切分失败";
            if (httpStatus != null) {
                // 状态已结构化落 details（IKIMS4），message 不再重复携带状态码字样：只剥网关
                // 文案的「: HTTP <code>」片段，上游原因 / body / request_id 等排查信息原样保留
                message = message.replaceAll(": HTTP " + httpStatus + "\\b", ":");
            }
            log.error("[video_scene_split] 终态失败 jobId={} code={}: {}", claim.id(), code, message, e);
            failClaimed(claim, code, message, httpStatus);
        }
    }

    /**
     * 分相主逻辑（去字幕 runStep 同构）：凭证 → submit 相 / poll 相。
     */
    private void runStep(ClaimedJob claim) {
        String providerToken;
        try {
            providerToken = upstreamCredential.requireKey();
        } catch (IllegalStateException e) {
            log.warn("[video_scene_split] 生成服务凭证未配置 jobId={}: {}", claim.id(), e.getMessage());
            failClaimed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING, "生成服务凭证未配置");
            return;
        }

        if (claim.providerTaskId() == null) {
            submitPhase(claim, providerToken);
        } else {
            pollPhase(claim, providerToken);
        }
    }

    // ========== submit 相 ==========

    /**
     * 提交相：解析冻结 input + 源视频 → 网关提交（granularity → segment_threshold 在客户端
     * 单处映射）→ markProviderSubmitted → 续排轮询。
     */
    private void submitPhase(ClaimedJob claim, String providerToken) {
        // 0. IKI89T（ADR-0114）：重试收割——retry job 先查父任务上游，终局（已发布或
        //    失租/守卫未命中停止执行，IKICD0）则不重新提交
        //    （IKI8GN：骨架收敛至 ParentResultReuse，家族差异=齐全判定/发布入口以参数表达）
        if (claim.parentProviderTaskId() != null) {
            if (ParentResultReuse.tryReuseParentResult(VideoSceneSplitContract.TAG, claim, providerToken,
                    segmentScenesClient::poll,
                    this::sceneSplitResultIncomplete,
                    this::publishResult)) {
                return;
            }
        }

        Map<String, Object> input = claim.input();

        // 1. 解析冻结 input 业务键（IKH8BH 契约两键恒在、值恒为合法枚举，创建时定死；
        //    此处为 worker 兜底防御，权威复核在创建入口
        String sourceAssetId = parseAssetId(input.get(VideoSceneSplitContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId == null) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "缺少源视频资产 id");
            return;
        }
        Object granularityObj = input.get(VideoSceneSplitContract.INPUT_KEY_GRANULARITY);
        if (!(granularityObj instanceof String granularity)
                || !VideoSceneSplitContract.SUPPORTED_GRANULARITIES.contains(granularity)) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "场景切分粒度非法");
            return;
        }

        // 2. 解析源视频素材：Asset url 落库即公网 public-read，直接作 video_url（去字幕同构）
        AssetEntity source = assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.userId()),
                Long.parseLong(claim.projectId()));
        if (source == null || !"video".equals(source.getType())
                || source.getUrl() == null || source.getUrl().isEmpty()) {
            failClaimed(claim, VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED,
                    "源视频素材不可用");
            return;
        }

        // 3. 网关提交异步任务（granularity 映射 / 高级参数不暴露在客户端单处定义）
        if (claim.parentProviderTaskId() != null && !stateMachine.reserveParentReuseSubmit(
                claim.id(), claim.workerId(), claim.fencingToken())) {
            return;
        }
        String taskId = segmentScenesClient.submit(providerToken, source.getUrl(), granularity);
        log.info("[video_scene_split] 上游已提交 jobId={} providerTaskId={} granularity={}",
                claim.id(), taskId, granularity);

        // 4. markProviderSubmitted（视频骨架复用件：存 provider_task_id + 释放租约 + next+5s；
        //    SQL 无 type 过滤，video_scene_split 直接复用）
        boolean updated = stateMachine.markProviderSubmitted(
                claim.id(), claim.workerId(), claim.fencingToken(), taskId);
        if (updated) {
            scheduleNext(claim.id(), SCENE_SPLIT_POLL_INTERVAL_MS);
        }
    }

    /**
     * 收割齐全判定（IKI8GN 家族差异参数）：切片数组非空，对齐轮询相 completed 成功判据。
     * 返回 null=齐全；非空=未齐原因短句（嵌进共享骨架「未命中(父任务{})」日志）。
     */
    private String sceneSplitResultIncomplete(ClaimedJob claim,
                                              SceneSplitTaskObservation observation) {
        return observation.segments() == null || observation.segments().isEmpty()
                ? "切片数组为空" : null;
    }

    // ========== poll 相 ==========

    /**
     * 轮询相：查询任务 → 瞬时错误续排 / processing 续排（含超限）/ failed 终态 /
     * completed 逐段下载转存发布。
     */
    private void pollPhase(ClaimedJob claim, String providerToken) {
        SceneSplitTaskObservation observation;
        try {
            observation = segmentScenesClient.poll(providerToken, claim.providerTaskId());
        } catch (VideoSceneSplitError pollError) {
            if (isTransientPollError(pollError)) {
                // 轮询上限对瞬时错误同样生效（IKI61M，对齐 IKI4M4 调速先例）：上游持续故障
                // （超时 / 429 / 5xx）时每次瞬时错误都走续排，poll_count 由
                // rescheduleProviderPoll 同一 SQL 累计（与 processing 分支共享预算）——
                // 若此处不判上限，poll_count 涨到 720 也进不了失败终态，卡片永远停在
                // 生成中。与 processing 分支同一判定、同一兜底码，文案附上游错误摘要（IKIHKR）。
                if (claim.pollCount() >= MAX_SCENE_SPLIT_POLLS) {
                    log.warn("[video_scene_split] 轮询瞬时错误且已达轮询上限 jobId={} pollCount={} err={}，归失败终态",
                            claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                    // 预算耗尽分支与顶层 catch 同一透传口径（IKIN6X / 父单 IKIN6H「有 cause
                    // 即透传」）：当次错误 cause 链携带上游 HTTP 状态即写 details.http_status
                    // 并剥文案「: HTTP <code>」片段（上游原因保留），无 cause 不写键。
                    Integer httpStatus = NewApiHttpSupport.upstreamHttpStatus(pollError);
                    String message = "场景切分轮询超时（超过 " + MAX_SCENE_SPLIT_POLLS
                            + " 次），上游持续错误: " + pollError.getMessage();
                    if (httpStatus != null) {
                        message = message.replaceAll(": HTTP " + httpStatus + "\\b", ":");
                    }
                    failClaimed(claim, VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED,
                            message, httpStatus);
                    return;
                }
                log.warn("[video_scene_split] 轮询瞬时错误 jobId={} pollCount={} err={}，重排继续轮询",
                        claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                boolean updated = stateMachine.rescheduleProviderPoll(
                        claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
                if (updated) {
                    scheduleNext(claim.id(), SCENE_SPLIT_POLL_INTERVAL_MS);
                }
                return;
            }
            throw pollError;
        }

        if ("processing".equals(observation.status())) {
            if (claim.pollCount() >= MAX_SCENE_SPLIT_POLLS) {
                // 轮询超时归并兜底码（同步家族口径：宁可不重试也不双跑；用户手动重试会重新提交）
                failClaimed(claim, VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED,
                        "场景切分轮询超时（超过 " + MAX_SCENE_SPLIT_POLLS + " 次）");
                return;
            }
            boolean updated = stateMachine.rescheduleProviderPoll(
                    claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
            if (updated) {
                scheduleNext(claim.id(), SCENE_SPLIT_POLL_INTERVAL_MS);
            }
            return;
        }

        if ("failed".equals(observation.status())) {
            // 上游可读原因透传；额度/内容政策信号按 §5 保留既有码（去字幕分类链同款：
            // 版权 → 内容政策 → 额度 → 兜底 1046）
            String message = observation.upstreamMessage() != null && !observation.upstreamMessage().isEmpty()
                    ? observation.upstreamMessage() : "场景切分任务失败";
            String code = classifyUpstreamFailure(observation.upstreamCode(), observation.upstreamMessage());
            log.info("[video_scene_split] 上游状态终态=failed jobId={} providerTaskId={} code={} pollCount={}",
                    claim.id(), claim.providerTaskId(), code, claim.pollCount());
            failClaimed(claim, code, message);
            return;
        }

        // completed（succeeded）
        log.info("[video_scene_split] 上游状态终态=completed jobId={} providerTaskId={} pollCount={} segments={}",
                claim.id(), claim.providerTaskId(), claim.pollCount(),
                observation.segments() != null ? observation.segments().size() : 0);
        if (observation.segments() == null || observation.segments().isEmpty()) {
            // return_segment_videos 走默认 true 恒返回切片；无段 = 异常形态（segments
            // 字段缺失/空数组；行形状非法已在客户端抛整体失败），落兜底不特判 1 段
            failClaimed(claim, VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED,
                    "场景切分任务成功但未返回场景段");
            return;
        }
        publishResult(claim, observation);
    }

    /**
     * 结果发布：逐段立即下载转存（火山 segment_video_url 仅 24h 有效，官方明确「请及时
     * 下载保存」；每段转存前心跳续租防长窗口租约过期，续租未命中即中止；任一段失败即
     * 整体失败——异常上抛由 handle 归并 1046，此前已转存的段无 Asset 行、不留半成品资产
     * 悬挂）→ 单事务逐段建 Asset（type=video / source='generated'）
     * + 契约 result 回传（段序 / 起止秒 / 段资产引用 / 总时长）→ 终态 succeeded。
     * <p>
     * 返回 false 有两个来源：段转存心跳续租未命中（中止转存，含续租状态无法确认的 DB
     * 异常）、终态发布守卫未命中。poll 相调用方忽略返回值（静默退出）；重试收割调用方
     * 对两者均停止本次执行不回退提交（IKICD0：失租或已终态后回退只会在 markProviderSubmitted
     * 守卫丢弃前白付一次上游 submit，产生无人轮询的孤儿上游任务；任务保持 processing，
     * 由新 worker 重新领取后重新检查父任务继续收割）。
     */
    private boolean publishResult(ClaimedJob claim,
                                  SceneSplitTaskObservation observation) {
        // TOS 强依赖：切片链接 24h 失效，不允许降级直存（去字幕家族口径）
        if (mediaRelay == null) {
            throw new VideoSceneSplitError(
                    VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED,
                    "场景切分转存存储未配置");
        }

        // 源素材近似元数据（官方不返回段宽高：切片不改变分辨率；时长缺失回落源 duration_ms）
        Integer width = null;
        Integer height = null;
        Double sourceDurationSec = null;
        String sourceAssetId = parseAssetId(
                claim.input().get(VideoSceneSplitContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId != null) {
            AssetEntity source = assetSource.resolve(
                    Long.parseLong(sourceAssetId),
                    Long.parseLong(claim.userId()),
                    Long.parseLong(claim.projectId()));
            if (source != null) {
                width = source.getWidth();
                height = source.getHeight();
                if (source.getDurationMs() != null) {
                    sourceDurationSec = source.getDurationMs() / 1000.0;
                }
            }
        }
        Double durationSec = observation.durationSec() != null
                ? observation.durationSec() : sourceDurationSec;
        Integer widthFinal = width;
        Integer heightFinal = height;

        // 逐段下载转存（官方顺序；段序 1 起编号，与前端段卡标注「第 N 段」同源）。
        // 每段转存前心跳续租（IKH8BP 审查修复）：N 段串行总时长可远超 claim 的 420s 租约，
        // 不续租则 recovery 判孤儿重投、新 claim 从头重复下载全部段，创建后 120 分钟重投
        // 窗口耗尽后任务静默卡 processing；续租未命中（已被接管/终态）即中止，stale worker
        // 静默退出不抢终态。
        List<SegmentObservation> observed = observation.segments();
        List<PublishVideoSceneSplitDto.Segment> segments = new ArrayList<>(observed.size());
        for (int i = 0; i < observed.size(); i++) {
            if (!renewLeaseForSegmentTransfer(claim, i, observed.size())) {
                return false;
            }
            SegmentObservation segment = observed.get(i);
            TosVideoMediaRelay.StoredVideo stored;
            try {
                stored = mediaRelay.persist(segment.segmentVideoUrl(), claim.userId());
            } catch (Exception e) {
                // 部分段失败 → 整体失败（契约口径）：包装段序后上抛，由 handle 归并兜底码；
                // 已转存的段无 Asset 行，不留半成品资产悬挂（TOS 孤儿对象与家族先例同口径）
                VideoSceneSplitError segmentFailure = new VideoSceneSplitError(
                        VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED,
                        "第 " + (i + 1) + " 段切片下载转存失败: " + e.getMessage());
                segmentFailure.initCause(e);
                throw segmentFailure;
            }
            segments.add(new PublishVideoSceneSplitDto.Segment(
                    i + 1,
                    segment.startTimeSec(),
                    segment.endTimeSec(),
                    stored.url(),
                    stored.storageKey(),
                    stored.mime(),
                    stored.size(),
                    stored.md5(),
                    widthFinal,
                    heightFinal));
        }
        log.info("[video_scene_split] 全段转存完成 jobId={} segments={} durationSec={}",
                claim.id(), segments.size(), durationSec);

        boolean published = finalizer.publishVideoSceneSplitResult(new PublishVideoSceneSplitDto(
                claim.id(),
                claim.projectId(),
                claim.userId(),
                claim.workerId(),
                claim.fencingToken(),
                durationSec,
                segments));
        if (published) {
            log.info("[video_scene_split] 发布成功 jobId={} assetSegments={}", claim.id(), segments.size());
        } else {
            log.warn("[video_scene_split] 终态失败(发布守卫未命中) jobId={}（stale worker 或已终态）",
                    claim.id());
        }
        return published;
    }

    /**
     * 段转存前心跳续租 + 进度上报（进度 = 已完成段占比，0-99 由状态机钳制；发布终态才置 100）。
     * 守卫未命中或 DB 异常均返回 false：任务已被新 worker 接管（或已终态），本 worker
     * 静默退出，已转存 TOS 对象成孤儿与家族口径一致（无 Asset 行、不留半成品悬挂）。
     */
    private boolean renewLeaseForSegmentTransfer(
            ClaimedJob claim, int transferred, int total) {
        int progress = (int) Math.floor(transferred * 100.0 / total);
        try {
            boolean renewed = stateMachine.updateVideoSceneSplitProgress(
                    new UpdateVideoSceneSplitProgressDto(
                            claim.id(), claim.workerId(), claim.fencingToken(), progress));
            if (!renewed) {
                log.warn("[video_scene_split] 段转存续租未命中(已被接管/终态)，中止转存 jobId={} segment={}/{}",
                        claim.id(), transferred + 1, total);
            }
            return renewed;
        } catch (Exception e) {
            log.warn("[video_scene_split] 段转存续租 DB 异常，中止转存 jobId={}: {}",
                    claim.id(), e.getMessage(), e);
            return false;
        }
    }

    // ========== 瞬时轮询错误判定（视频骨架 isTransientPollError 同语义） ==========

    /**
     * 瞬时轮询错误判定（去字幕 isTransientPollError 同语义）：网络超时 / 不可达 → 瞬时；
     * HTTP 429/5xx（cause 携带状态）→ 瞬时；4xx 与业务失败 → 非瞬时。
     */
    static boolean isTransientPollError(VideoSceneSplitError error) {
        String code = error.getCode();

        if (GenerationError.ERROR_PROVIDER_TIMEOUT.equals(code)) return true;

        if (GenerationError.ERROR_PROVIDER_FAILED.equals(code)) {
            Throwable cause = error.getCause();
            if (cause instanceof java.net.ConnectException
                    || cause instanceof java.net.UnknownHostException) {
                return true;
            }
            if (cause instanceof NewApiVideoClient.HttpStatusException hse) {
                int status = hse.getStatus();
                return status == 429 || status == 500 || status == 502
                        || status == 503 || status == 504;
            }
        }
        return false;
    }

    // ========== 工具方法 ==========

    /** Asset id 容忍数字形态（Jackson 数字 JSON 值），与去字幕解析同构。 */
    private static String parseAssetId(Object obj) {
        if (obj instanceof String s && !s.isEmpty()) return s;
        if (obj instanceof Number n) return String.valueOf(n.longValue());
        return null;
    }

    /**
     * 失败码归一（契约）：§5 分类信号（额度/内容政策）保留既有码，其余一律归并兜底
     * video_scene_split_failed（1046）。
     */
    private static String resolveFailCode(Exception e) {
        if (e instanceof VideoSceneSplitError vss && PRESERVED_ERROR_CODES.contains(vss.getCode())) {
            return vss.getCode();
        }
        return VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED;
    }

    /**
     * 上游任务 failed 的错误码分类（§5 优先级；去字幕分类链同款：
     * 版权 → 内容政策 → 额度 → 兜底 1046）。
     */
    private static String classifyUpstreamFailure(String upstreamCode, String upstreamMessage) {
        String text = (upstreamCode != null ? upstreamCode : "") + " "
                + (upstreamMessage != null ? upstreamMessage : "");
        if (NewApiErrorClassifier.isCopyrightSignal(text)) {
            return GenerationError.ERROR_CONTENT_REJECTED_REFERENCE;
        }
        if (NewApiErrorClassifier.isContentPolicySignal(text)) {
            return GenerationError.ERROR_CONTENT_REJECTED;
        }
        if (NewApiErrorClassifier.isQuotaSignal(text)) {
            return GenerationError.ERROR_QUOTA_EXHAUSTED;
        }
        return VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED;
    }

    /** 失败处理：走视频版 failVideoJob（视频骨架语义对齐；
     *  场景切分无输出槽位，槽位段天然空转；details.raw 透传原始原因）。 */
    private void failClaimed(ClaimedJob claim, String code, String msg) {
        failClaimed(claim, code, msg, null);
    }

    /** details 落结构化上游 HTTP 状态（IKIMS4，对齐音频提取 IKIMS2 / 音频混合 IKIHGQ 样板）：
     *  backend 换凭证判定读 {@link GenerationErrorDetailContract#ERROR_DETAIL_HTTP_STATUS}
     *  不依赖文案；非 HTTP 失败（超时 / 连接失败 / 业务信封失败）不写该键。轮询预算耗尽
     *  分支同样按 cause 透传（IKIN6X，父单 IKIN6H「有 cause 即透传」与迁移契约 §20 口径）：
     *  瞬时错误耗尽预算且 cause 携带状态即写，无 cause（超时 / 连接失败）不写。 */
    private void failClaimed(ClaimedJob claim, String code, String msg,
                             Integer httpStatus) {
        log.warn("video_scene_split job 失败 jobId={} code={} message={}", claim.id(), code, msg);
        Map<String, Object> details = new HashMap<>();
        details.put("raw", msg);
        if (httpStatus != null) {
            details.put(GenerationErrorDetailContract.ERROR_DETAIL_HTTP_STATUS, httpStatus);
        }
        finalizer.failVideoJob(claim.id(), code, msg, details,
                claim.workerId(), claim.fencingToken());
    }

    /** MQ 自投延迟消息（视频骨架 scheduleNext 同款；错误上抛保持不 ack 由 broker 重投兜底）。 */
    private void scheduleNext(String jobId, long delayMs) {
        try {
            producer.enqueue(jobId, delayMs);
        } catch (Exception e) {
            log.error("[video_scene_split] scheduleNext MQ 发送失败 jobId={} delayMs={}: {}",
                    jobId, delayMs, e.getMessage(), e);
            throw e;
        }
    }

    private static String hostname() {
        try {
            return java.net.InetAddress.getLocalHost().getHostName();
        } catch (Exception e) {
            return "unknown";
        }
    }
}
