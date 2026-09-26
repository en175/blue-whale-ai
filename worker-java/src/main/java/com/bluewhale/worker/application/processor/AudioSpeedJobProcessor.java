package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedAudioSpeedJobDto;
import com.bluewhale.worker.domain.dto.FailAudioSpeedDto;
import com.bluewhale.worker.domain.dto.PublishAudioSpeedDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.GenerationErrorDetailContract;
import com.bluewhale.worker.domain.contract.AudioSpeedContract;
import com.bluewhale.worker.domain.error.AudioSpeedError;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.worker.infrastructure.gateway.NewApiHttpSupport;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitAdjustAudioSpeedClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitAdjustAudioSpeedClient.AudioSpeedTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosAudioMediaRelay;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * audio_speed（音频调速，画布音频卡「调速」，火山 MediaKit adjust-audio-speed）作业处理器
 * （IKHW5A，父单 IKHVYO；编排一对一抄 {@link AudioTrimJobProcessor}——火山异步链复用
 * 视频轮询骨架，每步 = 一次 MQ 消费，fencing / 租约 / claim-by-id 全部走视频件）：
 * <ol>
 *   <li>claimAudioSpeed（富投影：providerTaskId / pollCount / progress）</li>
 *   <li>providerTaskId==null → 解析冻结 input + 源音频素材 → 网关提交（audio_url +
 *       speed 贴原速省略可选，返 task_id）→ markProviderSubmitted（存 provider_task_id +
 *       释放租约 + next+5s）→ scheduleNext(5s)</li>
 *   <li>providerTaskId!=null → 查询任务 → 瞬时错误 rescheduleProviderPoll 续排（与
 *       processing 共享 720 轮询预算，超限同归 1051）；processing →
 *       续排（超限 1051）；failed → 分类终态（§5）；completed → **立即下载转存自家 TOS
 *       （火山 audio_url 仅 24h 有效）** → 发布音频 Asset（type=audio）→ 终态 succeeded</li>
 * </ol>
 * 下载与转存复用 {@link TosAudioMediaRelay}（音频家族同套：fetch → audio/ mime 校验 →
 * TOS 公开读 → md5）；结果 URL 24h 失效故**强依赖 TOS，不降级直存**（家族口径）。
 * 转存扩展名 / mime 固定 {@link AudioSpeedContract#TRANSFER_OUTPUT_FORMAT}（m4a）——
 * 本产品不传官方 format 参数，产物格式跟随官方默认输出（契约 audio-speed.ts 口径）。
 * <p>
 * 产物时长：duration_ms 取官方 result.duration 秒换算（父单实现决策 1「产物时长以火山返回
 * duration 写回服务端权威时长」，ADR-0113 同口径）。**不做源时长回落**——调速产物时长 =
 * 源时长 / speed ≠ 源时长，回落语义不成立；官方值缺失即 null（assets.duration_ms 可空）。
 * <p>
 * 错误码口径（数值 1051，无 worker 级自动重试，用户手动重试沿用冻结 input〔源 + speed〕）：
 * <ul>
 *   <li>provider_credential_missing：任务缺少冻结凭证（与视频/截取同构；凭证冻结在
 *       创建入口）</li>
 *   <li>invalid_input：业务键缺失 / speed 非数字形态（创建入口复核是权威，worker 兜底
 *       防御；speed 值域 [0.1, 4.0] 是官方约束，越界由供应商侧拒、失败归任务口径）</li>
 *   <li>content_rejected / content_rejected_reference / quota_exhausted：NewApiErrorClassifier
 *       §5 分类信号（网关错误与火山 failed 双路），保留既有码投影</li>
 *   <li>audio_speed_failed（1051）：其余一律归并兜底——网关 provider_failed / 提交超时 /
 *       轮询超时 / 火山任务 failed（**含 speed 越界等供应商侧官方约束拒绝**，契约口径
 *       不单独识别）/ 源素材不可用 / 结果下载转存失败（超时也归并是家族口径：宁可不重试
 *       也不双跑），上游可读原因随 message 透传前端投影</li>
 * </ul>
 */
@Component
public class AudioSpeedJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(AudioSpeedJobProcessor.class);

    /** §5 分类信号白名单：这些既有码直接投影，其余全部归并 audio_speed_failed(1051)。 */
    private static final Set<String> PRESERVED_ERROR_CODES = Set.of(
            GenerationError.ERROR_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    /** 轮询步调 5s（音频截取 AUDIO_TRIM_POLL_INTERVAL_MS 同值）。 */
    public static final long AUDIO_SPEED_POLL_INTERVAL_MS = 5_000;

    /** 轮询上限 720 次 ≈ 60 分钟（家族 MAX_*_POLLS 同值：调速为重采样型任务，耗时上界
     *  低于重渲染，60 分钟窗口覆盖产品上限内最长任务）。 */
    public static final int MAX_AUDIO_SPEED_POLLS = 720;

    private final JobStateMachineService stateMachine;
    private final AssetSourceService assetSource;
    private final GenerationCredentialService credentialService;
    private final NewApiMediaKitAdjustAudioSpeedClient adjustAudioSpeedClient;
    private final TosAudioMediaRelay mediaRelay;
    private final GenerationMessageProducer producer;
    private final String workerId;

    public AudioSpeedJobProcessor(
            JobStateMachineService stateMachine,
            AssetSourceService assetSource,
            GenerationCredentialService credentialService,
            NewApiMediaKitAdjustAudioSpeedClient adjustAudioSpeedClient,
            TosAudioMediaRelay mediaRelay,
            @Qualifier("audioSpeedMessageProducer")
            GenerationMessageProducer producer
    ) {
        this.stateMachine = stateMachine;
        this.assetSource = assetSource;
        this.credentialService = credentialService;
        this.adjustAudioSpeedClient = adjustAudioSpeedClient;
        this.mediaRelay = mediaRelay;
        this.producer = producer;
        this.workerId = "aspeed-" + hostname() + "-" + ProcessHandle.current().pid();
    }

    @Override
    public String tag() {
        return AudioSpeedContract.TAG;
    }

    /**
     * 处理一个 audio_speed job step（每步 = 一次 MQ 消费）。
     * <p>
     * claim 在 try 外（家族同构：DB 异常上抛 → consumer 不 ack → 重投）；
     * 业务失败一律落终态 failed（无自动重试）。
     */
    @Override
    public void handle(String jobId) {
        Optional<ClaimedAudioSpeedJobDto> claimOpt;
        try {
            claimOpt = stateMachine.claimAudioSpeed(jobId, workerId);
        } catch (Exception error) {
            log.error("[audio_speed] claim 失败 jobId={}: {}",
                    jobId, error.getMessage(), error);
            throw error; // 保持不 ack → RocketMQ 重投
        }
        if (claimOpt.isEmpty()) return; // 无可认领 / 重复唤醒

        ClaimedAudioSpeedJobDto claim = claimOpt.get();
        log.info("[audio_speed] 已领取 jobId={} token={} providerTaskId={} pollCount={}",
                claim.id(), claim.fencingToken(), claim.providerTaskId(), claim.pollCount());

        try {
            runStep(claim);
        } catch (Exception e) {
            String code = resolveFailCode(e);
            Integer httpStatus = NewApiHttpSupport.upstreamHttpStatus(e);
            String message = e.getMessage() != null ? e.getMessage() : "音频调速失败";
            if (httpStatus != null) {
                // 状态已结构化落 details（IKIMS3），message 不再重复携带状态码字样：只剥网关
                // 文案的「: HTTP <code>」片段，上游原因 / body / request_id 等排查信息原样保留
                message = message.replaceAll(": HTTP " + httpStatus + "\\b", ":");
            }
            log.error("[audio_speed] 终态失败 jobId={} code={}: {}", claim.id(), code, message, e);
            failAudioSpeed(claim, code, message, httpStatus);
        }
    }

    /**
     * 分相主逻辑（家族 runStep 同构）：凭证 → submit 相 / poll 相。
     */
    private void runStep(ClaimedAudioSpeedJobDto claim) {
        // 取明文凭证（基础设施键；与视频/截取同构，冻结在创建入口）
        Object credentialObj = claim.input().get("provider_credential");
        if (!(credentialObj instanceof String providerCredential) || providerCredential.isEmpty()) {
            failAudioSpeed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "音频调速任务缺少供应商凭证");
            return;
        }
        String providerToken;
        try {
            providerToken = credentialService.open(providerCredential);
        } catch (Exception e) {
            log.debug("[audio_speed] 凭证无效 jobId={}: {}", claim.id(), e.getMessage(), e);
            failAudioSpeed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "音频调速任务凭证无效");
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
     * 提交相：解析冻结 input + 源音频 → 网关提交（贴原速省略口径下 speed 可选）→
     * markProviderSubmitted → 续排轮询。
     */
    private void submitPhase(ClaimedAudioSpeedJobDto claim, String providerToken) {
        Map<String, Object> input = claim.input();

        // 1. 解析冻结 input 业务键（source_asset_id 恒在、speed 可选〔贴原速省略，ADR-0113〕；
        //    创建时定死，此处为 worker 兜底防御，权威复核在创建入口。值域（[0.1, 4.0] /
        //    两位小数）是官方与产品约束，违反由创建入口拒或供应商侧拒、失败归任务口径
        //    （契约 audio-speed.ts 失败段）。
        String sourceAssetId = parseAssetId(input.get(AudioSpeedContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId == null) {
            failAudioSpeed(claim, GenerationError.ERROR_INVALID_INPUT, "缺少源音频资产 id");
            return;
        }
        Double speed = parseSpeed(input.get(AudioSpeedContract.INPUT_KEY_SPEED));
        if (speed == null && input.containsKey(AudioSpeedContract.INPUT_KEY_SPEED)) {
            failAudioSpeed(claim, GenerationError.ERROR_INVALID_INPUT, "播放倍速格式非法");
            return;
        }

        // 2. 解析源音频素材：Asset url 落库即公网 public-read，直接作 audio_url（家族同构）
        AssetEntity source = assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.userId()),
                Long.parseLong(claim.projectId()));
        if (source == null || !"audio".equals(source.getType())
                || source.getUrl() == null || source.getUrl().isEmpty()) {
            failAudioSpeed(claim, AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED,
                    "源音频资产不可用");
            return;
        }

        // 3. 网关提交异步任务（speed null 即不出键，走官方默认 1 原速）
        String taskId = adjustAudioSpeedClient.submit(providerToken, source.getUrl(), speed);
        log.info("[audio_speed] 上游已提交 jobId={} providerTaskId={} speed={}",
                claim.id(), taskId, speed);

        // 4. markProviderSubmitted（视频骨架复用件：存 provider_task_id + 释放租约 + next+5s；
        //    SQL 无 type 过滤，audio_speed 直接复用）
        boolean updated = stateMachine.markProviderSubmitted(
                claim.id(), claim.workerId(), claim.fencingToken(), taskId);
        if (updated) {
            scheduleNext(claim.id(), AUDIO_SPEED_POLL_INTERVAL_MS);
        }
    }

    // ========== poll 相 ==========

    /**
     * 轮询相：查询任务 → 瞬时错误续排 / processing 续排（含超限）/ failed 终态 /
     * completed 立即下载转存发布。
     */
    private void pollPhase(ClaimedAudioSpeedJobDto claim, String providerToken) {
        AudioSpeedTaskObservation observation;
        try {
            observation = adjustAudioSpeedClient.poll(providerToken, claim.providerTaskId());
        } catch (AudioSpeedError pollError) {
            if (isTransientPollError(pollError)) {
                // 轮询上限对瞬时错误同样生效（IKI4M4，对齐智能抠像 P1 修复）：上游持续故障
                // （超时 / 429 / 5xx）时每次瞬时错误都走续排，poll_count 由
                // rescheduleProviderPoll 同一 SQL 累计（与 processing 分支共享预算）——
                // 若此处不判上限，poll_count 涨到 720 也进不了失败终态，卡片永远停在
                // 生成中。与 processing 分支同一判定、同一兜底码，文案附上游错误摘要（IKIHKR）。
                if (claim.pollCount() >= MAX_AUDIO_SPEED_POLLS) {
                    log.warn("[audio_speed] 轮询瞬时错误且已达轮询上限 jobId={} pollCount={} err={}，归失败终态",
                            claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                    // 预算耗尽分支与顶层 catch 同一透传口径（IKIN6W，IKIMN8 契约）：有状态
                    // cause 即写 details.http_status 并剥「: HTTP <code>」片段；无 cause 不写键、文案不动
                    Integer httpStatus = NewApiHttpSupport.upstreamHttpStatus(pollError);
                    String message = "音频调速轮询超时（超过 " + MAX_AUDIO_SPEED_POLLS + " 次），上游持续错误: "
                            + pollError.getMessage();
                    if (httpStatus != null) {
                        message = message.replaceAll(": HTTP " + httpStatus + "\\b", ":");
                    }
                    failAudioSpeed(claim, AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED, message, httpStatus);
                    return;
                }
                log.warn("[audio_speed] 轮询瞬时错误 jobId={} pollCount={} err={}，重排继续轮询",
                        claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                boolean updated = stateMachine.rescheduleProviderPoll(
                        claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
                if (updated) {
                    scheduleNext(claim.id(), AUDIO_SPEED_POLL_INTERVAL_MS);
                }
                return;
            }
            throw pollError;
        }

        if ("processing".equals(observation.status())) {
            if (claim.pollCount() >= MAX_AUDIO_SPEED_POLLS) {
                // 轮询超时归并兜底码（家族口径：宁可不重试也不双跑；用户手动重试会重新提交）
                failAudioSpeed(claim, AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED,
                        "音频调速轮询超时（超过 " + MAX_AUDIO_SPEED_POLLS + " 次）");
                return;
            }
            boolean updated = stateMachine.rescheduleProviderPoll(
                    claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
            if (updated) {
                scheduleNext(claim.id(), AUDIO_SPEED_POLL_INTERVAL_MS);
            }
            return;
        }

        if ("failed".equals(observation.status())) {
            // 上游可读原因透传（speed 越界等官方约束拒绝走这里）；
            // 额度/内容政策信号按 §5 保留既有码（家族同款分类链）
            String message = observation.upstreamMessage() != null && !observation.upstreamMessage().isEmpty()
                    ? observation.upstreamMessage() : "音频调速任务失败";
            String code = classifyUpstreamFailure(observation.upstreamCode(), observation.upstreamMessage());
            log.info("[audio_speed] 上游状态终态=failed jobId={} providerTaskId={} code={} pollCount={}",
                    claim.id(), claim.providerTaskId(), code, claim.pollCount());
            failAudioSpeed(claim, code, message);
            return;
        }

        // completed（succeeded）
        log.info("[audio_speed] 上游状态终态=completed jobId={} providerTaskId={} pollCount={}",
                claim.id(), claim.providerTaskId(), claim.pollCount());
        if (observation.audioUrl() == null || observation.audioUrl().isEmpty()) {
            failAudioSpeed(claim, AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED,
                    "音频调速任务成功但未返回结果音频");
            return;
        }
        publishResult(claim, observation);
    }

    /**
     * 结果发布：立即下载转存（火山 audio_url 仅 24h 有效，官方明确「请及时下载保存」）→
     * 发布音频 Asset（type=audio / source='generated'）→ 终态 succeeded。
     */
    private void publishResult(ClaimedAudioSpeedJobDto claim,
                               AudioSpeedTaskObservation observation) {
        // TOS 强依赖：结果 URL 24h 失效，不允许降级直存（家族强依赖口径）
        if (mediaRelay == null) {
            throw new AudioSpeedError(
                    AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED,
                    "音频转存存储未配置");
        }
        TosAudioMediaRelay.StoredAudio stored =
                mediaRelay.persist(observation.audioUrl(), claim.userId(),
                        AudioSpeedContract.TRANSFER_OUTPUT_FORMAT);
        log.info("[audio_speed] 转存完成 jobId={} storageKey={} size={}",
                claim.id(), stored.storageKey(), stored.size());

        // 时长只取官方 result.duration 精确值（秒→ms；宽高恒 null——音频无画面维度，
        // publishAudioSpeedResult 内部落定）；不做源时长回落（调速产物时长 = 源时长/speed
        // ≠ 源时长，见类注释）
        boolean published = stateMachine.publishAudioSpeedResult(new PublishAudioSpeedDto(
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
                observation.durationSec()));
        if (published) {
            log.info("[audio_speed] 发布成功 jobId={}", claim.id());
        } else {
            log.warn("[audio_speed] 终态失败(发布守卫未命中) jobId={}（stale worker 或已终态）",
                    claim.id());
        }
    }

    // ========== 瞬时轮询错误判定（视频骨架 isTransientPollError 同语义） ==========

    /**
     * 瞬时轮询错误判定（家族同语义）：网络超时 / 不可达 → 瞬时；
     * HTTP 429/5xx（cause 携带状态）→ 瞬时；4xx 与业务失败 → 非瞬时。
     */
    static boolean isTransientPollError(AudioSpeedError error) {
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

    /** Asset id 容忍数字形态（Jackson 数字 JSON 值），与家族解析同构。 */
    private static String parseAssetId(Object obj) {
        if (obj instanceof String s && !s.isEmpty()) return s;
        if (obj instanceof Number n) return String.valueOf(n.longValue());
        return null;
    }

    /**
     * speed 键解析（Double）：**可 null**（贴原速省略口径——键不在或值为 null 都走官方
     * 默认 1）。Jackson 数字 JSON 值可能是 Integer / Double / BigDecimal，统一
     * {@code Number.doubleValue()}；非数字形态返回 null 由调用方区分「省略」与「脏值」。
     */
    private static Double parseSpeed(Object obj) {
        if (obj instanceof Number n) return n.doubleValue();
        return null;
    }

    /**
     * 失败码归一：§5 分类信号（额度/内容政策）保留既有码，其余一律归并兜底
     * audio_speed_failed（1051）。
     */
    private static String resolveFailCode(Exception e) {
        if (e instanceof AudioSpeedError ase && PRESERVED_ERROR_CODES.contains(ase.getCode())) {
            return ase.getCode();
        }
        return AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED;
    }

    /**
     * 上游任务 failed 的错误码分类（§5 优先级；家族分类链同款：
     * 版权 → 内容政策 → 额度 → 兜底 1051）。
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
        return AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED;
    }

    /** 失败处理（沿用家族 fail 守卫：SET 清 next_action_at + next_poll_at，轮询型任务
     *  语义完备；details.raw 透传原始原因）。 */
    private void failAudioSpeed(ClaimedAudioSpeedJobDto claim, String code, String message) {
        failAudioSpeed(claim, code, message, null);
    }

    /** details 落结构化上游 HTTP 状态（IKIMS3，音频提取 IKIMS2 同款）：backend 换凭证
     *  判定读 {@link GenerationErrorDetailContract#ERROR_DETAIL_HTTP_STATUS} 不依赖文案；
     *  非 HTTP 失败（超时 / 连接失败 / 业务信封失败）不写该键。 */
    private void failAudioSpeed(ClaimedAudioSpeedJobDto claim, String code, String message,
                                Integer httpStatus) {
        log.warn("audio_speed job 失败 jobId={} code={} message={}", claim.id(), code, message);
        Map<String, Object> details = new HashMap<>();
        details.put("raw", message);
        if (httpStatus != null) {
            details.put(GenerationErrorDetailContract.ERROR_DETAIL_HTTP_STATUS, httpStatus);
        }
        stateMachine.failAudioSpeedJob(new FailAudioSpeedDto(
                claim.id(),
                claim.workerId(),
                claim.fencingToken(),
                code,
                message,
                details
        ));
    }

    /** MQ 自投延迟消息（视频骨架 scheduleNext 同款；错误上抛保持不 ack 由 broker 重投兜底）。 */
    private void scheduleNext(String jobId, long delayMs) {
        try {
            producer.enqueue(jobId, delayMs);
        } catch (Exception e) {
            log.error("[audio_speed] scheduleNext MQ 发送失败 jobId={} delayMs={}: {}",
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
