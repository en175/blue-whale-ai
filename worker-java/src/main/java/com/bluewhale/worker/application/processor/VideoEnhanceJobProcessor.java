package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedVideoEnhanceJobDto;
import com.bluewhale.worker.domain.dto.PublishVideoEnhanceDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.entity.VideoEnhanceContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoEnhanceError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitEnhanceVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitEnhanceVideoClient.EnhanceVideoTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * video_enhance（视频 HD 高清，火山 MediaKit 画质增强大模型版）作业处理器（IKH3VF，
 * 父规格 IKH3VB，附录 C 触点③）。编排与去字幕 / 音视频分离同构（视频轮询骨架，每步 =
 * 一次 MQ 消费，fencing / 租约 / claim-by-id 全部走视频件）：
 * <ol>
 *   <li>claimVideoEnhance（富投影：providerTaskId / pollCount / progress）</li>
 *   <li>providerTaskId==null → 解析冻结 input + 源视频素材 → 网关提交（video_url +
 *       resolution + bitrate_level 恒 medium，fps 不传，返 task_id）→ markVideoSubmitted
 *       （存 provider_task_id + 释放租约 + next+5s）→ scheduleNext(5s)</li>
 *   <li>providerTaskId!=null → 查询任务 → 瞬时错误 rescheduleVideoPoll 续排；processing →
 *       续排（超限 1045）；failed → 分类终态；completed → **立即下载转存（火山 video_url
 *       仅 24h 有效）** → 建 Asset（type=video / source='generated'）→ 终态 succeeded</li>
 * </ol>
 * 下载与转存复用 {@link TosVideoMediaRelay}（视频家族同套：fetch → video/ mime 校验 →
 * TOS 公开读 → md5）；结果 URL 24h 失效故**强依赖 TOS，不降级直存**（对齐去字幕口径）。
 * <p>
 * 结果元数据（官方 result 仅返回 resolution 档位 / duration 秒 / fps，不返回输出宽高像素）：
 * 宽高按档位短边（{@link VideoEnhanceContract#RESOLUTION_SHORT_SIDE_PX}）+ 源宽高比推导
 * 入库（源宽高缺失 → null，静默容忍，去字幕同款口径），推导值支撑前端链式 HD 置灰判断
 * （ADR-0105：输出 2K/4K 卡短边超 1080 输入上限即置灰）；时长优先官方精确值、缺失回落源
 * duration_ms 换算；resolution / fps 落终态日志 payload（assets 无对应列）。
 * <p>
 * 错误码口径（数值 1045，无 worker 级自动重试，用户手动重试沿用冻结 input）：
 * <ul>
 *   <li>provider_credential_missing：任务缺少冻结凭证（与视频/去字幕同构；凭证冻结在
 *       创建入口 IKH3VE）</li>
 *   <li>invalid_input：业务键缺失 / resolution 枚举外（创建入口复核是权威，worker 兜底防御）</li>
 *   <li>content_rejected / content_rejected_reference / quota_exhausted：NewApiErrorClassifier
 *       §5 分类信号（网关错误与火山 failed 双路），保留既有码投影</li>
 *   <li>video_enhance_failed（1045）：其余一律归并兜底——网关 provider_failed / 提交超时 /
 *       轮询超时 / 火山任务 failed（**含 SDR 限制、短边/长边超限等供应商侧官方门槛拒绝**，
 *       宽高缺失放行的存量由上游拒，ADR-0105 任务失败口径兜底）/ 源素材不可用 / 结果下载
 *       转存失败（超时也归并是家族口径：宁可不重试也不双跑），上游可读原因随 message
 *       透传前端投影</li>
 * </ul>
 */
@Component
public class VideoEnhanceJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(VideoEnhanceJobProcessor.class);

    /** §5 分类信号白名单：这些既有码直接投影，其余全部归并 video_enhance_failed(1045)。 */
    private static final Set<String> PRESERVED_ERROR_CODES = Set.of(
            GenerationError.ERROR_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    /** 轮询步调 5s（去字幕 / 音视频分离 SUBTITLE_ERASE_POLL_INTERVAL_MS 同值）。 */
    public static final long VIDEO_ENHANCE_POLL_INTERVAL_MS = 5_000;

    /** 轮询上限 720 次 ≈ 60 分钟（家族 MAX_*_POLLS 同值：扩散大模型增强耗时上界高，
     *  对齐家族 60 分钟窗口，超限归并 1045）。 */
    public static final int MAX_VIDEO_ENHANCE_POLLS = 720;

    private final JobStateMachineService stateMachine;
    private final AssetSourceService assetSource;
    private final GenerationCredentialService credentialService;
    private final NewApiMediaKitEnhanceVideoClient enhanceVideoClient;
    private final TosVideoMediaRelay mediaRelay;
    private final GenerationMessageProducer producer;
    private final String workerId;

    public VideoEnhanceJobProcessor(
            JobStateMachineService stateMachine,
            AssetSourceService assetSource,
            GenerationCredentialService credentialService,
            NewApiMediaKitEnhanceVideoClient enhanceVideoClient,
            TosVideoMediaRelay mediaRelay,
            @Qualifier("videoEnhanceMessageProducer")
            GenerationMessageProducer producer
    ) {
        this.stateMachine = stateMachine;
        this.assetSource = assetSource;
        this.credentialService = credentialService;
        this.enhanceVideoClient = enhanceVideoClient;
        this.mediaRelay = mediaRelay;
        this.producer = producer;
        this.workerId = "venh-" + hostname() + "-" + ProcessHandle.current().pid();
    }

    @Override
    public String tag() {
        return VideoEnhanceContract.TAG;
    }

    /**
     * 处理一个 video_enhance step。
     * <p>
     * claim 在 try 外（视频骨架同构：DB 异常上抛 → consumer 不 ack → 重投）；
     * 业务失败一律落终态 failed（无自动重试）。
     */
    @Override
    public void handle(String jobId) {
        Optional<ClaimedVideoEnhanceJobDto> claimOpt;
        try {
            claimOpt = stateMachine.claimVideoEnhance(jobId, workerId);
        } catch (Exception error) {
            log.error("[video_enhance] claim 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error; // 保持不 ack → RocketMQ 重投
        }
        if (claimOpt.isEmpty()) return; // 无可认领 / 重复唤醒

        ClaimedVideoEnhanceJobDto claim = claimOpt.get();
        log.info("[video_enhance] 已领取 jobId={} token={} providerTaskId={} pollCount={}",
                claim.id(), claim.fencingToken(), claim.providerTaskId(), claim.pollCount());

        try {
            runStep(claim);
        } catch (Exception e) {
            String code = resolveFailCode(e);
            String message = e.getMessage() != null ? e.getMessage() : "视频画质增强失败";
            log.error("[video_enhance] 终态失败 jobId={} code={}: {}", claim.id(), code, message, e);
            failClaimed(claim, code, message);
        }
    }

    /**
     * 分相主逻辑（视频骨架 runVideoStep 同构）：凭证 → submit 相 / poll 相。
     */
    private void runStep(ClaimedVideoEnhanceJobDto claim) {
        // 取明文凭证（基础设施键；与视频/去字幕同构，冻结在创建入口 IKH3VE）
        Object credentialObj = claim.input().get("provider_credential");
        if (!(credentialObj instanceof String providerCredential) || providerCredential.isEmpty()) {
            failClaimed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "画质增强任务缺少供应商凭证");
            return;
        }
        String providerToken;
        try {
            providerToken = credentialService.open(providerCredential);
        } catch (Exception e) {
            log.debug("[video_enhance] 凭证无效 jobId={}: {}", claim.id(), e.getMessage(), e);
            failClaimed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "画质增强任务凭证无效");
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
     * 提交相：解析冻结 input + 源视频 → 网关提交 → markVideoSubmitted → 续排轮询。
     */
    private void submitPhase(ClaimedVideoEnhanceJobDto claim, String providerToken) {
        Map<String, Object> input = claim.input();

        // 1. 解析冻结 input 业务键（三键恒在、值恒为合法枚举；此处为 worker 兜底防御，
        //    权威复核在创建入口。target_node_id 是前端回填定位键，worker 不消费，不解析。
        String sourceAssetId = parseAssetId(input.get(VideoEnhanceContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId == null) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "缺少源视频资产 id");
            return;
        }
        Object resolutionObj = input.get(VideoEnhanceContract.INPUT_KEY_RESOLUTION);
        if (!(resolutionObj instanceof String resolution)
                || !VideoEnhanceContract.SUPPORTED_RESOLUTIONS.contains(resolution)) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "画质增强目标分辨率非法");
            return;
        }

        // 2. 解析源视频素材：Asset url 落库即公网 public-read，直接作 video_url（去字幕同构）；
        //    输入门槛（短边 [360,1080] / 长边 ≤1920 / 仅 SDR）不在 worker 复核——宽高缺失
        //    放行，交供应商按官方门槛拒，失败归任务口径（ADR-0105）。
        AssetEntity source = assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.user_id()),
                Long.parseLong(claim.project_id()));
        if (source == null || !"video".equals(source.getType())
                || source.getUrl() == null || source.getUrl().isEmpty()) {
            failClaimed(claim, VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED,
                    "源视频资产不可用");
            return;
        }

        // 3. 网关提交异步任务（bitrate_level 恒 medium / fps 不传在客户端单处定义）
        String taskId = enhanceVideoClient.submit(providerToken, source.getUrl(), resolution);
        log.info("[video_enhance] 上游已提交 jobId={} providerTaskId={} resolution={}",
                claim.id(), taskId, resolution);

        // 4. markVideoSubmitted（视频骨架复用件：存 provider_task_id + 释放租约 + next+5s）
        boolean updated = stateMachine.markVideoSubmitted(
                claim.id(), claim.workerId(), claim.fencingToken(), taskId);
        if (updated) {
            scheduleNext(claim.id(), VIDEO_ENHANCE_POLL_INTERVAL_MS);
        }
    }

    // ========== poll 相 ==========

    /**
     * 轮询相：查询任务 → 瞬时错误续排 / processing 续排（含超限）/ failed 终态 /
     * completed 立即下载转存发布。
     */
    private void pollPhase(ClaimedVideoEnhanceJobDto claim, String providerToken) {
        EnhanceVideoTaskObservation observation;
        try {
            observation = enhanceVideoClient.poll(providerToken, claim.providerTaskId());
        } catch (VideoEnhanceError pollError) {
            if (isTransientPollError(pollError)) {
                log.warn("[video_enhance] 轮询瞬时错误 jobId={} pollCount={} err={}，重排继续轮询",
                        claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                boolean updated = stateMachine.rescheduleVideoPoll(
                        claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
                if (updated) {
                    scheduleNext(claim.id(), VIDEO_ENHANCE_POLL_INTERVAL_MS);
                }
                return;
            }
            throw pollError;
        }

        if ("processing".equals(observation.status())) {
            if (claim.pollCount() >= MAX_VIDEO_ENHANCE_POLLS) {
                // 轮询超时归并兜底码（家族口径：宁可不重试也不双跑；用户手动重试会重新提交）
                failClaimed(claim, VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED,
                        "画质增强轮询超时（超过 " + MAX_VIDEO_ENHANCE_POLLS + " 次）");
                return;
            }
            boolean updated = stateMachine.rescheduleVideoPoll(
                    claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
            if (updated) {
                scheduleNext(claim.id(), VIDEO_ENHANCE_POLL_INTERVAL_MS);
            }
            return;
        }

        if ("failed".equals(observation.status())) {
            // 上游可读原因透传（SDR 限制 / 短边长边超限等官方门槛拒绝走这里）；
            // 额度/内容政策信号按 §5 保留既有码（去字幕同款分类链）
            String message = observation.upstreamMessage() != null && !observation.upstreamMessage().isEmpty()
                    ? observation.upstreamMessage() : "画质增强任务失败";
            String code = classifyUpstreamFailure(observation.upstreamCode(), observation.upstreamMessage());
            log.info("[video_enhance] 上游状态终态=failed jobId={} providerTaskId={} code={} pollCount={}",
                    claim.id(), claim.providerTaskId(), code, claim.pollCount());
            failClaimed(claim, code, message);
            return;
        }

        // completed（succeeded）
        log.info("[video_enhance] 上游状态终态=completed jobId={} providerTaskId={} pollCount={}",
                claim.id(), claim.providerTaskId(), claim.pollCount());
        if (observation.videoUrl() == null || observation.videoUrl().isEmpty()) {
            failClaimed(claim, VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED,
                    "画质增强任务成功但未返回结果视频");
            return;
        }
        publishResult(claim, observation);
    }

    /**
     * 结果发布：立即下载转存（火山 video_url 仅 24h 有效，官方明确「请及时下载保存」）→
     * 建 Asset（type=video / source='generated' / generation_job_id）→ 终态 succeeded。
     */
    private void publishResult(ClaimedVideoEnhanceJobDto claim,
                               EnhanceVideoTaskObservation observation) {
        // TOS 强依赖：结果 URL 24h 失效，不允许降级直存（对齐去字幕的强依赖口径）
        if (mediaRelay == null) {
            throw new VideoEnhanceError(
                    VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED,
                    "画质增强转存存储未配置");
        }
        TosVideoMediaRelay.StoredVideo stored =
                mediaRelay.persist(observation.videoUrl(), claim.user_id());
        log.info("[video_enhance] 转存完成 jobId={} storageKey={} size={}",
                claim.id(), stored.storageKey(), stored.size());

        // 官方不返回输出宽高像素 → 按分辨率档位短边 + 源宽高比推导（档位优先官方
        // result.resolution，缺失回落任务冻结 resolution；源宽高缺失 → null 静默容忍）。
        AssetEntity source = resolveSource(claim);
        String resolution = resolveOutputResolution(claim, observation.resolution());
        int[] dimensions = deriveOutputDimensions(source, resolution);

        // 时长优先官方 result.duration 精确值，缺失回落源 duration_ms 换算（去字幕同构）
        Double sourceDurationSec = null;
        if (source != null && source.getDurationMs() != null) {
            sourceDurationSec = source.getDurationMs() / 1000.0;
        }
        Double durationSec = observation.durationSec() != null
                ? observation.durationSec() : sourceDurationSec;

        boolean published = stateMachine.publishVideoEnhanceResult(new PublishVideoEnhanceDto(
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
                dimensions != null ? dimensions[0] : null,
                dimensions != null ? dimensions[1] : null,
                durationSec,
                resolution,
                observation.fps()));
        if (published) {
            log.info("[video_enhance] 发布成功 jobId={}", claim.id());
        } else {
            log.warn("[video_enhance] 终态失败(发布守卫未命中) jobId={}（stale worker 或已终态）",
                    claim.id());
        }
    }

    // ========== 瞬时轮询错误判定（视频骨架 isTransientPollError 同语义） ==========

    /**
     * 瞬时轮询错误判定（去字幕 isTransientPollError 同语义）：网络超时 / 不可达 → 瞬时；
     * HTTP 429/5xx（cause 携带状态）→ 瞬时；4xx 与业务失败 → 非瞬时。
     */
    static boolean isTransientPollError(VideoEnhanceError error) {
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

    /** 解析源 Asset（宽高供输出推导、时长供回落；归属三元组与提交相同构）。 */
    private AssetEntity resolveSource(ClaimedVideoEnhanceJobDto claim) {
        String sourceAssetId = parseAssetId(
                claim.input().get(VideoEnhanceContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId == null) return null;
        return assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.user_id()),
                Long.parseLong(claim.project_id()));
    }

    /** 输出档位：优先官方 result.resolution（小写归一），缺失回落任务冻结 resolution。 */
    private static String resolveOutputResolution(ClaimedVideoEnhanceJobDto claim, String upstream) {
        if (upstream != null) {
            String normalized = upstream.toLowerCase();
            if (VideoEnhanceContract.RESOLUTION_SHORT_SIDE_PX.containsKey(normalized)) {
                return normalized;
            }
        }
        Object frozen = claim.input().get(VideoEnhanceContract.INPUT_KEY_RESOLUTION);
        return frozen instanceof String s ? s : null;
    }

    /**
     * 输出宽高推导：档位短边（码率参考表口径 1080p/2k/4k → 1080/1440/2160）+ 源宽高比
     * （保持源横竖屏），长边四舍五入后取偶（视频编码尺寸偶数约束）。
     * 源宽高缺失 / 非法或档位未知 → null（§8 静默 null 等价标准，去字幕同款容忍）。
     */
    static int[] deriveOutputDimensions(AssetEntity source, String resolution) {
        if (source == null || resolution == null) return null;
        Integer shortSide = VideoEnhanceContract.RESOLUTION_SHORT_SIDE_PX.get(resolution);
        Integer srcWidth = source.getWidth();
        Integer srcHeight = source.getHeight();
        if (shortSide == null || srcWidth == null || srcHeight == null
                || srcWidth <= 0 || srcHeight <= 0) {
            return null;
        }
        int srcShort = Math.min(srcWidth, srcHeight);
        int srcLong = Math.max(srcWidth, srcHeight);
        int outShort = shortSide;
        int outLong = Math.round((float) srcLong * outShort / srcShort);
        if (outLong % 2 != 0) outLong += 1;
        // 保持源横竖屏：竖屏（源宽 ≤ 源高）→ 宽=短边、高=长边；横屏反之
        return srcWidth <= srcHeight
                ? new int[]{outShort, outLong} : new int[]{outLong, outShort};
    }

    /**
     * 失败码归一：§5 分类信号（额度/内容政策）保留既有码，其余一律归并兜底
     * video_enhance_failed（1045）。
     */
    private static String resolveFailCode(Exception e) {
        if (e instanceof VideoEnhanceError vee && PRESERVED_ERROR_CODES.contains(vee.getCode())) {
            return vee.getCode();
        }
        return VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED;
    }

    /**
     * 上游任务 failed 的错误码分类（§5 优先级；去字幕分类链同款：
     * 版权 → 内容政策 → 额度 → 兜底 1045）。
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
        return VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED;
    }

    /** 失败处理：走视频版 failVideoJob（轮询型任务守卫多清 next_poll_at，视频骨架语义对齐；
     *  HD 高清无输出槽位，槽位段天然空转；details.raw 透传原始原因）。 */
    private void failClaimed(ClaimedVideoEnhanceJobDto claim, String code, String msg) {
        log.warn("video_enhance job 失败 jobId={} code={} message={}", claim.id(), code, msg);
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
            log.error("[video_enhance] scheduleNext MQ 发送失败 jobId={} delayMs={}: {}",
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
