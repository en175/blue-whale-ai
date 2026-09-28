package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishVideoSubtitleEraseDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.GenerationErrorDetailContract;
import com.bluewhale.worker.domain.contract.VideoSubtitleEraseContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoSubtitleEraseError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.common.http.NewApiHttpSupport;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSubtitleEraseClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSubtitleEraseClient.SubtitleEraseTaskObservation;
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

/**
 * video_subtitle_erase（视频智能去字幕）作业处理器（迁移契约 §17 / IKGZ81，附录 C 触点③）。
 * <p>
 * 本仓首个 MediaKit **异步任务**：编排复用视频生成的多步状态机骨架（每步 = 一次 MQ 消费，
 * fencing / 租约 / claim-by-id 全部走视频件，不新建任务状态机形态）：
 * <ol>
 *   <li>claim（{@link ClaimSpec}：候选查询 / 租约秒 / CAS 见本类构造器）</li>
 *   <li>providerTaskId==null → 解析冻结 input + 源视频素材 → 网关提交（返 task_id）→
 *       markProviderSubmitted（存 provider_task_id + 释放租约 + next+5s）→ scheduleNext(5s)</li>
 *   <li>providerTaskId!=null → 查询任务 → 瞬时错误 rescheduleProviderPoll 续排（与
 *       processing 共享 720 轮询预算，超限同归 1043）；processing →
 *       续排；failed → 终态 1043 + 上游原因透传；completed → **立即下载转存（火山 URL 仅
 *       24h 有效）** → 建 Asset（type=video / source=generated）→ 终态 succeeded</li>
 * </ol>
 * 下载与转存复用 {@link TosVideoMediaRelay}（视频家族同套：fetch → video/ mime 校验 →
 * TOS 公开读 → md5）；结果 URL 24h 失效故**强依赖 TOS，不降级直存**（对齐 image_erase 的
 * 强依赖口径，区别于视频生成的 passthrough 容忍）。
 * <p>
 * 出站映射（§17.3）：mode 由客户端按 {@link VideoSubtitleEraseContract#MODE} 换算；
 * model_version=v5 / output_encode_mode=Quality 服务端常量；无框出站不发
 * erase_ratio_location 键。
 * <p>
 * 错误码口径（§17.5，无 worker 级自动重试，用户在结果卡手动重试并沿用冻结 input）：
 * <ul>
 *   <li>provider_credential_missing：任务缺少冻结凭证（与视频/image_erase 同构）</li>
 *   <li>invalid_input：业务键缺失 / 检测模式枚举外 / 框列表形状非法（创建入口 Z80 复核是
 *       权威，worker 兜底防御）</li>
 *   <li>content_rejected / content_rejected_reference / quota_exhausted：NewApiErrorClassifier
 *       §5 分类信号，保留既有码投影</li>
 *   <li>video_subtitle_erase_failed（1043）：其余一律归并兜底——提交失败 / 轮询超时 /
 *       供应商任务 failed / 源素材不可用 / 结果下载转存失败（超时也归并是同步家族口径：
 *       宁可不重试也不双跑），上游可读原因随 message 透传前端投影</li>
 * </ul>
 */
@Component
public class VideoSubtitleEraseJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(VideoSubtitleEraseJobProcessor.class);

    /** §5 分类信号白名单：这些既有码直接投影，其余全部归并 video_subtitle_erase_failed。 */
    private static final Set<String> PRESERVED_ERROR_CODES = Set.of(
            GenerationError.ERROR_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    /** 领取规格（IKIWP8 / ADR-0119）：候选 = type + 单源白名单；租约 420s。 */
    private static final int LEASE_SECONDS = 420;
    private static final List<String> CLAIM_SOURCES = List.of(VideoSubtitleEraseContract.SOURCE);

    /**
     * 轮询步调 5s（视频骨架 VIDEO_POLL_INTERVAL_MS 同值）。
     */
    public static final long SUBTITLE_ERASE_POLL_INTERVAL_MS = 5_000;

    /**
     * 轮询上限 720 次 ≈ 60 分钟（视频骨架 MAX_VIDEO_POLLS 同值）。规格 RTF 口径：V5 下
     * 10 分钟片约 5 倍耗时 = 50 分钟 &lt; 60 分钟，窗口覆盖产品上限内的最长任务。
     */
    public static final int MAX_SUBTITLE_ERASE_POLLS = 720;

    private final JobStateMachineService stateMachine;
    private final JobFinalizer finalizer;
    private final JobClaimService claimService;
    private final ClaimSpec claimSpec;
    private final AssetSourceService assetSource;
    private final GenerationCredentialService credentialService;
    private final NewApiMediaKitSubtitleEraseClient subtitleEraseClient;
    private final TosVideoMediaRelay mediaRelay;
    private final GenerationMessageProducer producer;
    private final String workerId;

    public VideoSubtitleEraseJobProcessor(
            JobStateMachineService stateMachine,
            JobClaimService claimService,
            GenerationJobMapper jobMapper,
            JobFinalizer finalizer,
            AssetSourceService assetSource,
            GenerationCredentialService credentialService,
            NewApiMediaKitSubtitleEraseClient subtitleEraseClient,
            TosVideoMediaRelay mediaRelay,
            @Qualifier("videoSubtitleEraseMessageProducer")
            GenerationMessageProducer producer
    ) {
        this.stateMachine = stateMachine;
        this.finalizer = finalizer;
        this.claimService = claimService;
        this.claimSpec = ClaimSpec.bySources(
                VideoSubtitleEraseContract.TAG, LEASE_SECONDS, CLAIM_SOURCES, jobMapper);
        this.assetSource = assetSource;
        this.credentialService = credentialService;
        this.subtitleEraseClient = subtitleEraseClient;
        this.mediaRelay = mediaRelay;
        this.producer = producer;
        this.workerId = "vse-" + hostname() + "-" + ProcessHandle.current().pid();
    }

    @Override
    public String tag() {
        return VideoSubtitleEraseContract.TAG;
    }

    /**
     * 本家族的领取规格：供「一个处理器 ↔ 一份规格」一致性断言枚举（IKIWP8 / ADR-0119）。
     */
    @Override
    public Optional<ClaimSpec> claimSpec() {
        return Optional.of(claimSpec);
    }

    /**
     * 处理一个 video_subtitle_erase step。
     * <p>
     * claim 在 try 外（视频骨架同构：DB 异常上抛 → consumer 不 ack → 重投）；
     * 业务失败一律落终态 failed（无自动重试，§17.5）。
     */
    @Override
    public void handle(String jobId) {
        Optional<ClaimedJob> claimOpt;
        try {
            claimOpt = claimService.claim(claimSpec, jobId, workerId);
        } catch (Exception error) {
            log.error("[video_subtitle_erase] claim 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error; // 保持不 ack → RocketMQ 重投
        }
        if (claimOpt.isEmpty()) return; // 无可认领 / 重复唤醒

        ClaimedJob claim = claimOpt.get();
        log.info("[video_subtitle_erase] 已领取 jobId={} token={} providerTaskId={} pollCount={}",
                claim.id(), claim.fencingToken(), claim.providerTaskId(), claim.pollCount());

        try {
            runStep(claim);
        } catch (Exception e) {
            String code = resolveFailCode(e);
            Integer httpStatus = NewApiHttpSupport.upstreamHttpStatus(e);
            String message = e.getMessage() != null ? e.getMessage() : "视频去字幕失败";
            if (httpStatus != null) {
                // 状态已结构化落 details（IKIMS4），message 不再重复携带状态码字样：只剥网关
                // 文案的「: HTTP <code>」片段，上游原因 / body / request_id 等排查信息原样保留
                message = message.replaceAll(": HTTP " + httpStatus + "\\b", ":");
            }
            log.error("[video_subtitle_erase] 终态失败 jobId={} code={}: {}", claim.id(), code, message, e);
            failClaimed(claim, code, message, httpStatus);
        }
    }

    /**
     * 分相主逻辑（视频骨架 runVideoStep 同构）：凭证 → submit 相 / poll 相。
     */
    private void runStep(ClaimedJob claim) {
        // 取明文凭证（§17.2 基础设施键；与视频/image_erase 同构，修正四：明文直通）
        Object credentialObj = claim.input().get("provider_credential");
        if (!(credentialObj instanceof String providerCredential) || providerCredential.isEmpty()) {
            failClaimed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "去字幕任务缺少供应商凭证");
            return;
        }
        String providerToken;
        try {
            providerToken = credentialService.open(providerCredential);
        } catch (Exception e) {
            log.debug("[video_subtitle_erase] 凭证无效 jobId={}: {}", claim.id(), e.getMessage(), e);
            failClaimed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "去字幕任务凭证无效");
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
     * 提交相：解析冻结 input + 源视频 → 网关提交 → markProviderSubmitted → 续排轮询。
     */
    private void submitPhase(ClaimedJob claim, String providerToken) {
        // 0. IKI89U（ADR-0114）：重试收割——retry job 先查父任务上游，终局（已发布或
        //    失租/守卫未命中停止执行，IKICD0）则不重新提交
        //    （IKI8GN：骨架收敛至 ParentResultReuse，家族差异=齐全判定/发布入口以参数表达）
        if (claim.parentProviderTaskId() != null) {
            if (ParentResultReuse.tryReuseParentResult(VideoSubtitleEraseContract.TAG, claim, providerToken,
                    subtitleEraseClient::poll,
                    ParentResultReuse.singleUrlIncomplete(SubtitleEraseTaskObservation::videoUrl),
                    this::publishResult)) {
                return;
            }
        }

        Map<String, Object> input = claim.input();

        // 1. 解析冻结 input 业务键（§17.2 四键恒在；此处为 worker 兜底防御，权威复核在 Z80。
        //    target_node_id 是前端回填定位键，worker 不消费，不解析。
        String sourceAssetId = parseAssetId(input.get(VideoSubtitleEraseContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId == null) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "缺少源素材 id");
            return;
        }
        Object modeObj = input.get(VideoSubtitleEraseContract.INPUT_KEY_DETECT_MODE);
        if (!(modeObj instanceof String detectMode)
                || !VideoSubtitleEraseContract.MODE.containsKey(detectMode)) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "去字幕检测模式非法");
            return;
        }
        List<Map<String, Object>> eraseBoxes = parseEraseBoxes(
                input.get(VideoSubtitleEraseContract.INPUT_KEY_ERASE_BOXES));
        if (eraseBoxes == null) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "擦除框列表非法");
            return;
        }

        // 2. 解析源视频素材：Asset url 落库即公网 public-read，直接作 video_url（§17.5）
        AssetEntity source = assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.userId()),
                Long.parseLong(claim.projectId()));
        if (source == null || !"video".equals(source.getType())
                || source.getUrl() == null || source.getUrl().isEmpty()) {
            failClaimed(claim, VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED,
                    "源视频素材不可用");
            return;
        }

        // 3. 网关提交异步任务（mode 映射 / 固定参数 / 框出站规则在客户端单处定义，§17.3）
        if (claim.parentProviderTaskId() != null && !stateMachine.reserveParentReuseSubmit(
                claim.id(), claim.workerId(), claim.fencingToken())) {
            return;
        }
        String taskId = subtitleEraseClient.submit(
                providerToken, source.getUrl(), detectMode, eraseBoxes);
        log.info("[video_subtitle_erase] 上游已提交 jobId={} providerTaskId={}", claim.id(), taskId);

        // 4. markProviderSubmitted（视频骨架复用件：存 provider_task_id + 释放租约 + next+5s）
        boolean updated = stateMachine.markProviderSubmitted(
                claim.id(), claim.workerId(), claim.fencingToken(), taskId);
        if (updated) {
            scheduleNext(claim.id(), SUBTITLE_ERASE_POLL_INTERVAL_MS);
        }
    }

    // ========== poll 相 ==========

    /**
     * 轮询相：查询任务 → 瞬时错误续排 / processing 续排（含超限）/ failed 终态 /
     * completed 立即下载转存发布。
     */
    private void pollPhase(ClaimedJob claim, String providerToken) {
        SubtitleEraseTaskObservation observation;
        try {
            observation = subtitleEraseClient.poll(providerToken, claim.providerTaskId());
        } catch (VideoSubtitleEraseError pollError) {
            if (isTransientPollError(pollError)) {
                // 轮询上限对瞬时错误同样生效（IKI61M，对齐 IKI4M4 调速先例）：上游持续故障
                // （超时 / 429 / 5xx）时每次瞬时错误都走续排，poll_count 由
                // rescheduleProviderPoll 同一 SQL 累计（与 processing 分支共享预算）——
                // 若此处不判上限，poll_count 涨到 720 也进不了失败终态，卡片永远停在
                // 生成中。与 processing 分支同一判定、同一兜底码，文案附上游错误摘要（IKIHKR）。
                if (claim.pollCount() >= MAX_SUBTITLE_ERASE_POLLS) {
                    log.warn("[video_subtitle_erase] 轮询瞬时错误且已达轮询上限 jobId={} pollCount={} err={}，归失败终态",
                            claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                    // 预算耗尽分支与顶层 catch 同一透传口径（IKIN6X / 父单 IKIN6H「有 cause
                    // 即透传」）：当次错误 cause 链携带上游 HTTP 状态即写 details.http_status
                    // 并剥文案「: HTTP <code>」片段（上游原因保留），无 cause 不写键。
                    Integer httpStatus = NewApiHttpSupport.upstreamHttpStatus(pollError);
                    String message = "去字幕轮询超时（超过 " + MAX_SUBTITLE_ERASE_POLLS
                            + " 次），上游持续错误: " + pollError.getMessage();
                    if (httpStatus != null) {
                        message = message.replaceAll(": HTTP " + httpStatus + "\\b", ":");
                    }
                    failClaimed(claim, VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED,
                            message, httpStatus);
                    return;
                }
                log.warn("[video_subtitle_erase] 轮询瞬时错误 jobId={} pollCount={} err={}，重排继续轮询",
                        claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                boolean updated = stateMachine.rescheduleProviderPoll(
                        claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
                if (updated) {
                    scheduleNext(claim.id(), SUBTITLE_ERASE_POLL_INTERVAL_MS);
                }
                return;
            }
            throw pollError;
        }

        if ("processing".equals(observation.status())) {
            if (claim.pollCount() >= MAX_SUBTITLE_ERASE_POLLS) {
                // 轮询超时归并兜底码（同步家族口径：宁可不重试也不双跑；用户手动重试会重新提交）
                failClaimed(claim, VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED,
                        "去字幕轮询超时（超过 " + MAX_SUBTITLE_ERASE_POLLS + " 次）");
                return;
            }
            boolean updated = stateMachine.rescheduleProviderPoll(
                    claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
            if (updated) {
                scheduleNext(claim.id(), SUBTITLE_ERASE_POLL_INTERVAL_MS);
            }
            return;
        }

        if ("failed".equals(observation.status())) {
            // 上游可读原因透传（§17.5）；额度/内容政策信号按 §5 保留既有码（视频 poll failed 同款分类链）
            String message = observation.upstreamMessage() != null && !observation.upstreamMessage().isEmpty()
                    ? observation.upstreamMessage() : "去字幕任务失败";
            String code = classifyUpstreamFailure(observation.upstreamCode(), observation.upstreamMessage());
            log.info("[video_subtitle_erase] 上游状态终态=failed jobId={} providerTaskId={} code={} pollCount={}",
                    claim.id(), claim.providerTaskId(), code, claim.pollCount());
            failClaimed(claim, code, message);
            return;
        }

        // completed（succeeded）
        log.info("[video_subtitle_erase] 上游状态终态=completed jobId={} providerTaskId={} pollCount={}",
                claim.id(), claim.providerTaskId(), claim.pollCount());
        if (observation.videoUrl() == null || observation.videoUrl().isEmpty()) {
            failClaimed(claim, VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED,
                    "去字幕任务成功但未返回结果视频");
            return;
        }
        publishResult(claim, observation);
    }

    /**
     * 结果发布：立即下载转存（火山 URL 仅 24h 有效，官方明确「请及时下载保存」）→
     * 建 Asset（type=video / source='generated' / generation_job_id）→ 终态 succeeded。
     * <p>
     * 返回发布守卫结果（IKI89U：重试收割据此判定复用是否成立；false = 守卫未命中，
     * 收割方停止执行不回退提交——IKICD0 统一失租与守卫未命中为停止终局）。
     */
    private boolean publishResult(ClaimedJob claim,
                                  SubtitleEraseTaskObservation observation) {
        // TOS 强依赖：结果 URL 24h 失效，不允许降级直存（对齐 image_erase 的强依赖口径）
        if (mediaRelay == null) {
            throw new VideoSubtitleEraseError(
                    VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED,
                    "去字幕转存存储未配置");
        }
        TosVideoMediaRelay.StoredVideo stored =
                mediaRelay.persist(observation.videoUrl(), claim.userId());
        log.info("[video_subtitle_erase] 转存完成 jobId={} storageKey={} size={}",
                claim.id(), stored.storageKey(), stored.size());

        // 官方不返回输出宽高（输出=输入、输入超 1080P 压 1080P）→ 取源 Asset 值近似
        //（列可空容忍 null；时长优先官方 result.duration 精确值，缺失回落源 duration_ms 换算）
        Integer width = null;
        Integer height = null;
        Double sourceDurationSec = null;
        Object sourceAssetIdObj = claim.input().get(VideoSubtitleEraseContract.INPUT_KEY_SOURCE_ASSET_ID);
        String sourceAssetId = parseAssetId(sourceAssetIdObj);
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

        boolean published = finalizer.publishVideoSubtitleEraseResult(new PublishVideoSubtitleEraseDto(
                claim.id(),
                claim.projectId(),
                claim.userId(),
                claim.workerId(),
                claim.fencingToken(),
                stored.url(),
                stored.storageKey(),
                stored.mime(),
                stored.size(),
                stored.md5(),
                width,
                height,
                durationSec));
        if (published) {
            log.info("[video_subtitle_erase] 发布成功 jobId={}", claim.id());
        } else {
            log.warn("[video_subtitle_erase] 终态失败(发布守卫未命中) jobId={}（stale worker 或已终态）",
                    claim.id());
        }
        return published;
    }

    // ========== 瞬时轮询错误判定（视频骨架 isTransientPollError 同语义） ==========

    /**
     * 瞬时轮询错误判定（视频骨架 video-job-runner isTransientPollError 同语义）：
     * 网络超时 / 不可达 → 瞬时；HTTP 429/5xx（cause 携带状态）→ 瞬时；4xx 与业务失败 → 非瞬时。
     */
    static boolean isTransientPollError(VideoSubtitleEraseError error) {
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

    /**
     * 擦除框列表解析（worker 兜底防御）：null / 非数组 → null（invalid_input）；
     * 元素非对象 → null；≤20 与 [0,1] 坐标复核权威在创建入口（Z80），框内四键与官方
     * Location 同名同值原样透传（§17.2）。
     */
    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> parseEraseBoxes(Object value) {
        if (!(value instanceof List<?> list)) return null;
        List<Map<String, Object>> boxes = new ArrayList<>();
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> map)) return null;
            boxes.add((Map<String, Object>) map);
        }
        return boxes;
    }

    /** Asset id 容忍数字形态（Jackson 数字 JSON 值），与 image_erase 解析同构。 */
    private static String parseAssetId(Object obj) {
        if (obj instanceof String s && !s.isEmpty()) return s;
        if (obj instanceof Number n) return String.valueOf(n.longValue());
        return null;
    }

    /**
     * 失败码归一（§17.5）：§5 分类信号（额度/内容政策）保留既有码，其余一律归并兜底
     * video_subtitle_erase_failed（1043）。
     */
    private static String resolveFailCode(Exception e) {
        if (e instanceof VideoSubtitleEraseError vse && PRESERVED_ERROR_CODES.contains(vse.getCode())) {
            return vse.getCode();
        }
        return VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED;
    }

    /**
     * 上游任务 failed 的错误码分类（§5 优先级；视频 poll failed 分类链同款：
     * 版权 → 内容政策 → 额度 → 兜底 1043）。
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
        return VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED;
    }

    /** 失败处理：走视频版 failVideoJob（轮询型任务守卫多清 next_poll_at，视频骨架语义对齐；
     *  去字幕无输出槽位，槽位段天然空转；details.raw 透传原始原因）。 */
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
        log.warn("video_subtitle_erase job 失败 jobId={} code={} message={}", claim.id(), code, msg);
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
            log.error("[video_subtitle_erase] scheduleNext MQ 发送失败 jobId={} delayMs={}: {}",
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
