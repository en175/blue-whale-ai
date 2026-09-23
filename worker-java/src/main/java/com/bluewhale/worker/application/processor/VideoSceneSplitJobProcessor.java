package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedVideoSceneSplitJobDto;
import com.bluewhale.worker.domain.dto.PublishVideoSceneSplitDto;
import com.bluewhale.worker.domain.dto.UpdateVideoSceneSplitProgressDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.VideoSceneSplitContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoSceneSplitError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSegmentScenesClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSegmentScenesClient.SceneSplitTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSegmentScenesClient.SegmentObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
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

/**
 * video_scene_split（视频场景切分）作业处理器（IKH8BP，父规格 IKH86V，附录 C 触点③）。
 * <p>
 * 火山 MediaKit **异步任务 + 一对多扇出**：编排复用视频生成的多步状态机骨架（每步 =
 * 一次 MQ 消费，fencing / 租约 / claim-by-id 全部走视频件，去字幕
 * {@link VideoSubtitleEraseJobProcessor} / 音视频分离 {@link MediaExtractJobProcessor} 同构）：
 * <ol>
 *   <li>claimVideoSceneSplit（富投影：providerTaskId / pollCount / progress）</li>
 *   <li>providerTaskId==null → 解析冻结 input + 源视频素材 → 网关提交（granularity 经契约
 *       SEGMENT_THRESHOLD 映射 segment_threshold，返 task_id）→ markProviderSubmitted（存
 *       provider_task_id + 释放租约 + next+5s）→ scheduleNext(5s)</li>
 *   <li>providerTaskId!=null → 查询任务 → 瞬时错误 rescheduleProviderPoll 续排；processing →
 *       续排；failed → 分类终态；completed → **逐段下载切片转存自家 TOS（火山
 *       segment_video_url 仅 24h 有效；每段转存前心跳续租防长窗口租约过期）** → 单事务逐段
 *       建 Asset + 契约 result 回传 → 终态 succeeded</li>
 * </ol>
 * 下载与转存复用 {@link TosVideoMediaRelay}（视频家族同套：fetch → video/ mime 校验 →
 * TOS 公开读 → md5）；切片链接 24h 失效故**强依赖 TOS，不降级直存**（去字幕家族口径）。
 * <p>
 * **逐段转存与部分失败口径（工单验收标准）**：completed 后先逐段下载转存收集产物列表，
 * 每段转存前 updateVideoSceneSplitProgress 心跳续租（N 段串行总时长可远超 claim 的 420s
 * 租约，审查修复细节见该方法 javadoc）；全部段转存成功才进 publish 事务（单事务逐段建
 * Asset + output_asset_ids + 契约 result 回传）；任一段下载/转存失败即整体失败（契约：
 * video_scene_split_failed 1046 归并），此时无任何段 Asset 落库（不建半成品资产行），
 * 已上传的 TOS 孤儿对象与家族先例同口径（转存后守卫未命中同款，无 Asset 引用即无悬挂）。
 * <p>
 * 出站映射：只传 model / video_url / segment_threshold——min_duration（默认 3s）/
 * max_duration（默认 30s）/ enable_clip_fade（默认 false）/ return_segment_videos（默认
 * true）一律不传走服务端默认（规格「高级参数不暴露」）；两阶段切分（threshold+min 初切、
 * 超 max 强制再切）由上游完成，返回 segments[] 照单全收，整片仅 1 段不特判（规格故事 18）。
 * <p>
 * 错误码口径（契约：数值 1046，无 worker 级自动重试，用户在任务占位卡手动重试沿用冻结 input）：
 * <ul>
 *   <li>provider_credential_missing：任务缺少冻结凭证（与视频/去字幕同构）</li>
 *   <li>invalid_input：业务键缺失 / 粒度枚举外（创建入口复核是权威，worker 兜底防御）</li>
 *   <li>content_rejected / content_rejected_reference / quota_exhausted：NewApiErrorClassifier
 *       §5 分类信号，保留既有码投影</li>
 *   <li>video_scene_split_failed（1046）：其余一律归并兜底——提交失败 / 轮询超时 / 供应商
 *       任务 failed（error 对象 code / message / param / type——TaskError / ApiError）/
 *       源素材不可用 / 结果无段 / 逐段下载转存失败（任一段即整体失败；超时也归并是同步
 *       家族口径：宁可不重试也不双跑），上游可读原因随 message 透传前端投影</li>
 * </ul>
 */
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

    private final JobStateMachineService stateMachine;
    private final AssetSourceService assetSource;
    private final GenerationCredentialService credentialService;
    private final NewApiMediaKitSegmentScenesClient segmentScenesClient;
    private final TosVideoMediaRelay mediaRelay;
    private final GenerationMessageProducer producer;
    private final String workerId;

    public VideoSceneSplitJobProcessor(
            JobStateMachineService stateMachine,
            AssetSourceService assetSource,
            GenerationCredentialService credentialService,
            NewApiMediaKitSegmentScenesClient segmentScenesClient,
            TosVideoMediaRelay mediaRelay,
            @Qualifier("videoSceneSplitMessageProducer")
            GenerationMessageProducer producer
    ) {
        this.stateMachine = stateMachine;
        this.assetSource = assetSource;
        this.credentialService = credentialService;
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
     * 处理一个 video_scene_split step。
     * <p>
     * claim 在 try 外（视频骨架同构：DB 异常上抛 → consumer 不 ack → 重投）；
     * 业务失败一律落终态 failed（无自动重试）。
     */
    @Override
    public void handle(String jobId) {
        Optional<ClaimedVideoSceneSplitJobDto> claimOpt;
        try {
            claimOpt = stateMachine.claimVideoSceneSplit(jobId, workerId);
        } catch (Exception error) {
            log.error("[video_scene_split] claim 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error; // 保持不 ack → RocketMQ 重投
        }
        if (claimOpt.isEmpty()) return; // 无可认领 / 重复唤醒

        ClaimedVideoSceneSplitJobDto claim = claimOpt.get();
        log.info("[video_scene_split] 已领取 jobId={} token={} providerTaskId={} pollCount={}",
                claim.id(), claim.fencingToken(), claim.providerTaskId(), claim.pollCount());

        try {
            runStep(claim);
        } catch (Exception e) {
            String code = resolveFailCode(e);
            String message = e.getMessage() != null ? e.getMessage() : "场景切分失败";
            log.error("[video_scene_split] 终态失败 jobId={} code={}: {}", claim.id(), code, message, e);
            failClaimed(claim, code, message);
        }
    }

    /**
     * 分相主逻辑（去字幕 runStep 同构）：凭证 → submit 相 / poll 相。
     */
    private void runStep(ClaimedVideoSceneSplitJobDto claim) {
        // 取明文凭证（基础设施键；与视频/去字幕同构，修正四：明文直通）
        Object credentialObj = claim.input().get("provider_credential");
        if (!(credentialObj instanceof String providerCredential) || providerCredential.isEmpty()) {
            failClaimed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "场景切分任务缺少供应商凭证");
            return;
        }
        String providerToken;
        try {
            providerToken = credentialService.open(providerCredential);
        } catch (Exception e) {
            log.debug("[video_scene_split] 凭证无效 jobId={}: {}", claim.id(), e.getMessage(), e);
            failClaimed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "场景切分任务凭证无效");
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
    private void submitPhase(ClaimedVideoSceneSplitJobDto claim, String providerToken) {
        // 0. IKI89T（ADR-0114）：重试收割——retry job 先查父任务上游，命中则不重新提交
        if (claim.parentProviderTaskId() != null) {
            if (tryReuseParentResult(claim, providerToken)) {
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
                Long.parseLong(claim.user_id()),
                Long.parseLong(claim.project_id()));
        if (source == null || !"video".equals(source.getType())
                || source.getUrl() == null || source.getUrl().isEmpty()) {
            failClaimed(claim, VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED,
                    "源视频素材不可用");
            return;
        }

        // 3. 网关提交异步任务（granularity 映射 / 高级参数不暴露在客户端单处定义）
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
     * IKI89T（ADR-0114）：重试收割（parent-reuse，视频 IKEA26 先例推广）。
     * <p>
     * 超窗判失败后上游任务仍在跑；用户手动重试时先查父任务的上游任务：已成功且切片数组
     * 非空（对齐本家族轮询相成功口径）→ 不重新提交，直接以父任务 observation 走既有
     * {@link #publishResult} 发布（逐段转存、资产入库、项目事件与正常完成同型，不新建
     * cost 记录）。父任务失败 / 不存在 / 查询异常 / 收割发布失败四种形态一律返回 false，
     * 回退 submit 相正常重新提交，无第三种行为分支。
     */
    private boolean tryReuseParentResult(ClaimedVideoSceneSplitJobDto claim, String providerToken) {
        SceneSplitTaskObservation observation;
        try {
            observation = segmentScenesClient.poll(providerToken, claim.parentProviderTaskId());
        } catch (Exception error) {
            // 不存在与查询异常同路处理（视频先例 D6 同款：当不存在，重新 submit）
            log.warn("[video_scene_split] 重试收割查父任务失败 jobId={} parentTask={} err={}，按不存在处理重新提交",
                    claim.id(), claim.parentProviderTaskId(), error.getMessage(), error);
            return false;
        }

        if (!"succeeded".equals(observation.status())) {
            log.info("[video_scene_split] 重试收割未命中(父任务未成功) jobId={} parentTask={} status={}，回退重新提交",
                    claim.id(), claim.parentProviderTaskId(), observation.status());
            return false;
        }
        if (observation.segments() == null || observation.segments().isEmpty()) {
            log.info("[video_scene_split] 重试收割未命中(父任务切片数组为空) jobId={} parentTask={}，回退重新提交",
                    claim.id(), claim.parentProviderTaskId());
            return false;
        }

        log.info("[video_scene_split] 重试收割命中 jobId={} parentTask={}，复用旧结果发布（不重新提交）",
                claim.id(), claim.parentProviderTaskId());
        try {
            boolean published = publishResult(claim, observation);
            if (!published) {
                log.warn("[video_scene_split] 重试收割发布未命中守卫 jobId={}（stale worker 或已终态），回退重新提交",
                        claim.id());
            }
            return published;
        } catch (Exception error) {
            // 结果取回/发布失败（如切片 URL 已超 24h 失效下载 404）→ 回退重新提交兜底
            log.warn("[video_scene_split] 重试收割发布失败 jobId={} parentTask={} err={}，回退重新提交",
                    claim.id(), claim.parentProviderTaskId(), error.getMessage(), error);
            return false;
        }
    }

    // ========== poll 相 ==========

    /**
     * 轮询相：查询任务 → 瞬时错误续排 / processing 续排（含超限）/ failed 终态 /
     * completed 逐段下载转存发布。
     */
    private void pollPhase(ClaimedVideoSceneSplitJobDto claim, String providerToken) {
        SceneSplitTaskObservation observation;
        try {
            observation = segmentScenesClient.poll(providerToken, claim.providerTaskId());
        } catch (VideoSceneSplitError pollError) {
            if (isTransientPollError(pollError)) {
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
     * 返回 false 有两个来源：段转存心跳续租未命中（中止转存）、终态发布守卫未命中。poll 相
     * 调用方忽略返回值（静默退出）；重试收割调用方据此回退正常重新提交——续租/发布/提交
     * 三守卫 WHERE 同构，回退后 markProviderSubmitted 必同样未命中，无 DB 双写，代价为一份
     * 无人轮询的孤儿上游任务。
     */
    private boolean publishResult(ClaimedVideoSceneSplitJobDto claim,
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
                    Long.parseLong(claim.user_id()),
                    Long.parseLong(claim.project_id()));
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
                stored = mediaRelay.persist(segment.segmentVideoUrl(), claim.user_id());
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

        boolean published = stateMachine.publishVideoSceneSplitResult(new PublishVideoSceneSplitDto(
                claim.id(),
                claim.project_id(),
                claim.user_id(),
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
            ClaimedVideoSceneSplitJobDto claim, int transferred, int total) {
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

    /** 失败处理：走视频版 failVideoJob（轮询型任务守卫多清 next_poll_at，视频骨架语义对齐；
     *  场景切分无输出槽位，槽位段天然空转；details.raw 透传原始原因）。 */
    private void failClaimed(ClaimedVideoSceneSplitJobDto claim, String code, String msg) {
        log.warn("video_scene_split job 失败 jobId={} code={} message={}", claim.id(), code, msg);
        Map<String, Object> details = new HashMap<>();
        details.put("raw", msg);
        stateMachine.failVideoJob(claim.id(), code, msg, details,
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
