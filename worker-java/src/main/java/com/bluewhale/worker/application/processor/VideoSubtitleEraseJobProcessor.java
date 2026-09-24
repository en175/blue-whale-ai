package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedVideoSubtitleEraseJobDto;
import com.bluewhale.worker.domain.dto.PublishVideoSubtitleEraseDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.VideoSubtitleEraseContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoSubtitleEraseError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSubtitleEraseClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSubtitleEraseClient.SubtitleEraseTaskObservation;
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
 * video_subtitle_erase（视频智能去字幕）作业处理器（迁移契约 §17 / IKGZ81，附录 C 触点③）。
 * <p>
 * 本仓首个 MediaKit **异步任务**：编排复用视频生成的多步状态机骨架（每步 = 一次 MQ 消费，
 * fencing / 租约 / claim-by-id 全部走视频件，不新建任务状态机形态）：
 * <ol>
 *   <li>claimVideoSubtitleErase（富投影：providerTaskId / pollCount / progress）</li>
 *   <li>providerTaskId==null → 解析冻结 input + 源视频素材 → 网关提交（返 task_id）→
 *       markProviderSubmitted（存 provider_task_id + 释放租约 + next+5s）→ scheduleNext(5s)</li>
 *   <li>providerTaskId!=null → 查询任务 → 瞬时错误 rescheduleProviderPoll 续排；processing →
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
    private final AssetSourceService assetSource;
    private final GenerationCredentialService credentialService;
    private final NewApiMediaKitSubtitleEraseClient subtitleEraseClient;
    private final TosVideoMediaRelay mediaRelay;
    private final GenerationMessageProducer producer;
    private final String workerId;

    public VideoSubtitleEraseJobProcessor(
            JobStateMachineService stateMachine,
            AssetSourceService assetSource,
            GenerationCredentialService credentialService,
            NewApiMediaKitSubtitleEraseClient subtitleEraseClient,
            TosVideoMediaRelay mediaRelay,
            @Qualifier("videoSubtitleEraseMessageProducer")
            GenerationMessageProducer producer
    ) {
        this.stateMachine = stateMachine;
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
     * 处理一个 video_subtitle_erase step。
     * <p>
     * claim 在 try 外（视频骨架同构：DB 异常上抛 → consumer 不 ack → 重投）；
     * 业务失败一律落终态 failed（无自动重试，§17.5）。
     */
    @Override
    public void handle(String jobId) {
        Optional<ClaimedVideoSubtitleEraseJobDto> claimOpt;
        try {
            claimOpt = stateMachine.claimVideoSubtitleErase(jobId, workerId);
        } catch (Exception error) {
            log.error("[video_subtitle_erase] claim 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error; // 保持不 ack → RocketMQ 重投
        }
        if (claimOpt.isEmpty()) return; // 无可认领 / 重复唤醒

        ClaimedVideoSubtitleEraseJobDto claim = claimOpt.get();
        log.info("[video_subtitle_erase] 已领取 jobId={} token={} providerTaskId={} pollCount={}",
                claim.id(), claim.fencingToken(), claim.providerTaskId(), claim.pollCount());

        try {
            runStep(claim);
        } catch (Exception e) {
            String code = resolveFailCode(e);
            String message = e.getMessage() != null ? e.getMessage() : "视频去字幕失败";
            log.error("[video_subtitle_erase] 终态失败 jobId={} code={}: {}", claim.id(), code, message, e);
            failClaimed(claim, code, message);
        }
    }

    /**
     * 分相主逻辑（视频骨架 runVideoStep 同构）：凭证 → submit 相 / poll 相。
     */
    private void runStep(ClaimedVideoSubtitleEraseJobDto claim) {
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
    private void submitPhase(ClaimedVideoSubtitleEraseJobDto claim, String providerToken) {
        // 0. IKI89U（ADR-0114）：重试收割——retry job 先查父任务上游，命中则不重新提交
        if (claim.parentProviderTaskId() != null) {
            if (tryReuseParentResult(claim, providerToken)) {
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
                Long.parseLong(claim.user_id()),
                Long.parseLong(claim.project_id()));
        if (source == null || !"video".equals(source.getType())
                || source.getUrl() == null || source.getUrl().isEmpty()) {
            failClaimed(claim, VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED,
                    "源视频素材不可用");
            return;
        }

        // 3. 网关提交异步任务（mode 映射 / 固定参数 / 框出站规则在客户端单处定义，§17.3）
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

    /**
     * IKI89U（ADR-0114）：重试收割（parent-reuse，视频 IKEA26 先例推广）。
     * <p>
     * 超窗判失败后上游任务仍在跑；用户手动重试时先查父任务的上游任务：已成功且结果
     * URL 齐全 → 不重新提交，直接以父任务 observation 走既有 {@link #publishResult}
     * 发布（资产入库、源宽高/时长近似回填、项目事件与正常完成同型，不新建 cost 记录）。
     * 父任务失败 / 不存在 / 查询异常 / 收割发布失败四种形态一律返回 false，
     * 回退 submit 相正常重新提交，无第三种行为分支。
     */
    private boolean tryReuseParentResult(ClaimedVideoSubtitleEraseJobDto claim, String providerToken) {
        SubtitleEraseTaskObservation observation;
        try {
            observation = subtitleEraseClient.poll(providerToken, claim.parentProviderTaskId());
        } catch (Exception error) {
            // 不存在与查询异常同路处理（视频先例 D6 同款：当不存在，重新 submit）
            log.warn("[video_subtitle_erase] 重试收割查父任务失败 jobId={} parentTask={} err={}，按不存在处理重新提交",
                    claim.id(), claim.parentProviderTaskId(), error.getMessage(), error);
            return false;
        }

        if (!"succeeded".equals(observation.status())) {
            log.info("[video_subtitle_erase] 重试收割未命中(父任务未成功) jobId={} parentTask={} status={}，回退重新提交",
                    claim.id(), claim.parentProviderTaskId(), observation.status());
            return false;
        }
        if (observation.videoUrl() == null || observation.videoUrl().isEmpty()) {
            log.info("[video_subtitle_erase] 重试收割未命中(父任务结果不齐全) jobId={} parentTask={}，回退重新提交",
                    claim.id(), claim.parentProviderTaskId());
            return false;
        }

        log.info("[video_subtitle_erase] 重试收割命中 jobId={} parentTask={}，复用旧结果发布（不重新提交）",
                claim.id(), claim.parentProviderTaskId());
        try {
            boolean published = publishResult(claim, observation);
            if (!published) {
                log.warn("[video_subtitle_erase] 重试收割发布未命中守卫 jobId={}（stale worker 或已终态），回退重新提交",
                        claim.id());
            }
            return published;
        } catch (Exception error) {
            // 结果取回/发布失败（如结果 URL 已超 24h 失效下载 404）→ 回退重新提交兜底
            log.warn("[video_subtitle_erase] 重试收割发布失败 jobId={} parentTask={} err={}，回退重新提交",
                    claim.id(), claim.parentProviderTaskId(), error.getMessage(), error);
            return false;
        }
    }

    // ========== poll 相 ==========

    /**
     * 轮询相：查询任务 → 瞬时错误续排 / processing 续排（含超限）/ failed 终态 /
     * completed 立即下载转存发布。
     */
    private void pollPhase(ClaimedVideoSubtitleEraseJobDto claim, String providerToken) {
        SubtitleEraseTaskObservation observation;
        try {
            observation = subtitleEraseClient.poll(providerToken, claim.providerTaskId());
        } catch (VideoSubtitleEraseError pollError) {
            if (isTransientPollError(pollError)) {
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
     * 返回发布守卫结果（IKI89U：重试收割据此判定复用是否成立，false 回退正常重新提交）。
     */
    private boolean publishResult(ClaimedVideoSubtitleEraseJobDto claim,
                                  SubtitleEraseTaskObservation observation) {
        // TOS 强依赖：结果 URL 24h 失效，不允许降级直存（对齐 image_erase 的强依赖口径）
        if (mediaRelay == null) {
            throw new VideoSubtitleEraseError(
                    VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED,
                    "去字幕转存存储未配置");
        }
        TosVideoMediaRelay.StoredVideo stored =
                mediaRelay.persist(observation.videoUrl(), claim.user_id());
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

        boolean published = stateMachine.publishVideoSubtitleEraseResult(new PublishVideoSubtitleEraseDto(
                claim.id(),
                claim.project_id(),
                claim.user_id(),
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
    private void failClaimed(ClaimedVideoSubtitleEraseJobDto claim, String code, String msg) {
        log.warn("video_subtitle_erase job 失败 jobId={} code={} message={}", claim.id(), code, msg);
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
