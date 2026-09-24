package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedMediaExtractJobDto;
import com.bluewhale.worker.domain.dto.FailMediaExtractDto;
import com.bluewhale.worker.domain.dto.PublishMediaExtractDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.MediaExtractContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.MediaExtractError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitExtractAudioClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitExtractAudioClient.ExtractAudioTaskObservation;
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
 * media_extract（音视频分离）作业处理器——火山 MediaKit 异步链（迁移契约 §18 / IKH28W）。
 * <p>
 * 执行面从本地 ffmpeg 单步同步流（IKARDY 时代）整体切换为火山异步任务，编排复用视频
 * 轮询骨架（每步 = 一次 MQ 消费，去字幕 {@link VideoSubtitleEraseJobProcessor} 同构）：
 * <ol>
 *   <li>claimMediaExtract（富投影：providerTaskId / pollCount / progress，§18 冻结）</li>
 *   <li>providerTaskId==null → 解析冻结 input + 源视频素材 → 网关提交（带 output_format，
 *       返 task_id）→ markProviderSubmitted（存 provider_task_id + 释放租约 + next+5s）→
 *       scheduleNext(5s)</li>
 *   <li>providerTaskId!=null → 查询任务 → 瞬时错误 rescheduleProviderPoll 续排（与
 *       processing 共享 720 轮询预算，超限同归 1044）；processing →
 *       续排（超限 1044）；failed → 分类终态（§18.4）；completed → **立即下载转存自家 TOS
 *       （火山 audio_url 仅 24h 有效）** → 发布音频 Asset（type=audio）→ 终态 succeeded</li>
 * </ol>
 * 输入上限随火山口径（官方 PDF：建议 ≤10GB、最高 4K），旧 200MiB 本地判定
 * （TosMediaStorage.download 内）仅存活于 ffmpeg 链路，本路径不经过。
 * <b>本地 ffmpeg 链路代码零改动保留</b>（FfmpegExtractor 及其测试、Dockerfile ffmpeg
 * 安装、backend ffmpeg-static，ADR-0103 双执行路径并存），本类不再调用。
 * <p>
 * 错误码口径（§18.4 三类映射，无 worker 级自动重试，用户手动重试沿用冻结 input）：
 * <ul>
 *   <li>provider_credential_missing：任务缺少冻结凭证（与视频/去字幕同构；凭证冻结在
 *       创建入口 IKH28V）</li>
 *   <li>invalid_input：业务键缺失 / output_format 枚举外（创建入口复核是权威，worker
 *       兜底防御）</li>
 *   <li>content_rejected / content_rejected_reference / quota_exhausted：NewApiErrorClassifier
 *       §5 分类信号（网关错误与火山 failed 双路），保留既有码投影</li>
 *   <li>media_extract_provider_failed（1044）：其余一律归并兜底——网关 provider_failed /
 *       提交超时 / 轮询超时 / 火山任务 failed（含无音轨，契约定稿不单独识别）/
 *       源素材不可用 / 结果下载转存失败（超时也归并是家族口径：宁可不重试也不双跑），
 *       上游可读原因随 message 透传前端投影</li>
 * </ul>
 * <p>
 * 进度口径对齐去字幕：markProviderSubmitted 落 progress=1（SQL 侧）、轮询 rescheduleProviderPoll
 * 保持不倒退、publishResultGuard 终态 progress=100；旧 ffmpeg 链路的
 * updateMediaExtractProgress 心跳（下载带 21-90 映射）不再使用。
 */
@Component
public class MediaExtractJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(MediaExtractJobProcessor.class);

    /** §5 分类信号白名单：这些既有码直接投影，其余全部归并 media_extract_provider_failed(1044)。 */
    private static final Set<String> PRESERVED_ERROR_CODES = Set.of(
            GenerationError.ERROR_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    /** 轮询步调 5s（去字幕 SUBTITLE_ERASE_POLL_INTERVAL_MS / 视频骨架同值）。 */
    public static final long MEDIA_EXTRACT_POLL_INTERVAL_MS = 5_000;

    /** 轮询上限 720 次 ≈ 60 分钟（去字幕 MAX_SUBTITLE_ERASE_POLLS 同值：音频提取为
     *  抽轨转换型任务，耗时上界低于去字幕的重渲染，60 分钟窗口覆盖产品上限内最长任务）。 */
    public static final int MAX_MEDIA_EXTRACT_POLLS = 720;

    private final JobStateMachineService stateMachine;
    private final AssetSourceService assetSource;
    private final GenerationCredentialService credentialService;
    private final NewApiMediaKitExtractAudioClient extractAudioClient;
    private final TosAudioMediaRelay mediaRelay;
    private final GenerationMessageProducer producer;
    private final String workerId;

    public MediaExtractJobProcessor(
            JobStateMachineService stateMachine,
            AssetSourceService assetSource,
            GenerationCredentialService credentialService,
            NewApiMediaKitExtractAudioClient extractAudioClient,
            TosAudioMediaRelay mediaRelay,
            @Qualifier("mediaExtractMessageProducer")
            GenerationMessageProducer producer
    ) {
        this.stateMachine = stateMachine;
        this.assetSource = assetSource;
        this.credentialService = credentialService;
        this.extractAudioClient = extractAudioClient;
        this.mediaRelay = mediaRelay;
        this.producer = producer;
        // workerId = extract-{hostname}-{pid}（media-extract-worker.service.ts:18，沿用）
        this.workerId = "extract-" + hostname() + "-" + ProcessHandle.current().pid();
    }

    @Override
    public String tag() {
        return MediaExtractContract.TAG;
    }

    /**
     * 处理一个 media_extract job step（每步 = 一次 MQ 消费）。
     * <p>
     * claim 在 try 外（IKC9EJ：DB 异常上抛 → consumer 不 ack → 重投）；
     * 业务失败一律落终态 failed（无自动重试，§18.4）。
     */
    @Override
    public void handle(String jobId) {
        Optional<ClaimedMediaExtractJobDto> claimOpt;
        try {
            claimOpt = stateMachine.claimMediaExtract(jobId, workerId);
        } catch (Exception error) {
            log.error("[media_extract] claim 失败 jobId={}: {}",
                    jobId, error.getMessage(), error);
            throw error; // 保持不 ack → RocketMQ 重投
        }
        if (claimOpt.isEmpty()) return; // 无可认领 / 重复唤醒

        ClaimedMediaExtractJobDto claim = claimOpt.get();
        log.info("[media_extract] 已领取 jobId={} token={} providerTaskId={} pollCount={}",
                claim.id(), claim.fencingToken(), claim.providerTaskId(), claim.pollCount());

        try {
            runStep(claim);
        } catch (Exception e) {
            String code = resolveFailCode(e);
            String message = e.getMessage() != null ? e.getMessage() : "音视频分离失败";
            log.error("[media_extract] 终态失败 jobId={} code={}: {}", claim.id(), code, message, e);
            failMediaExtract(claim, code, message);
        }
    }

    /**
     * 分相主逻辑（去字幕 runStep 同构）：凭证 → submit 相 / poll 相。
     */
    private void runStep(ClaimedMediaExtractJobDto claim) {
        // 取明文凭证（与视频/去字幕同构，修正四：明文直通；冻结在创建入口 IKH28V）
        Object credentialObj = claim.input().get("provider_credential");
        if (!(credentialObj instanceof String providerCredential) || providerCredential.isEmpty()) {
            failMediaExtract(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "音视频分离任务缺少供应商凭证");
            return;
        }
        String providerToken;
        try {
            providerToken = credentialService.open(providerCredential);
        } catch (Exception e) {
            log.debug("[media_extract] 凭证无效 jobId={}: {}", claim.id(), e.getMessage(), e);
            failMediaExtract(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "音视频分离任务凭证无效");
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
     * 提交相：解析冻结 input + 源视频 → 网关提交（带 output_format）→ markProviderSubmitted →
     * 续排轮询。
     */
    private void submitPhase(ClaimedMediaExtractJobDto claim, String providerToken) {
        // 0. IKI89P（ADR-0114）：重试收割——retry job 先查父任务上游，终局（已发布或
        //    失租/守卫未命中停止执行，IKICD0）则不重新提交
        //    （IKI8GN：骨架收敛至 ParentResultReuse，家族差异=齐全判定/发布入口以参数表达）
        if (claim.parentProviderTaskId() != null) {
            if (ParentResultReuse.tryReuseParentResult(MediaExtractContract.TAG, claim, providerToken,
                    extractAudioClient::poll,
                    ParentResultReuse.singleUrlIncomplete(ExtractAudioTaskObservation::audioUrl),
                    this::publishResult)) {
                return;
            }
        }

        Map<String, Object> input = claim.input();

        // 1. 解析冻结 input 业务键（§18.2 两键恒在、值恒为合法枚举，创建时定死；此处为
        //    worker 兜底防御，权威复核在创建入口）
        String sourceAssetId = parseAssetId(input.get(MediaExtractContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId == null) {
            failMediaExtract(claim, GenerationError.ERROR_INVALID_INPUT, "缺少源视频资产 id");
            return;
        }
        Object formatObj = input.get(MediaExtractContract.INPUT_KEY_OUTPUT_FORMAT);
        if (!(formatObj instanceof String outputFormat)
                || !MediaExtractContract.SUPPORTED_OUTPUT_FORMATS.contains(outputFormat)) {
            failMediaExtract(claim, GenerationError.ERROR_INVALID_INPUT, "音频提取输出格式非法");
            return;
        }

        // 2. 解析源视频素材：Asset url 落库即公网 public-read，直接作 video_url（去字幕同构）
        AssetEntity source = assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.userId()),
                Long.parseLong(claim.projectId()));
        if (source == null || !"video".equals(source.getType())
                || source.getUrl() == null || source.getUrl().isEmpty()) {
            failMediaExtract(claim, MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED,
                    "源视频资产不可用");
            return;
        }

        // 3. 网关提交异步任务（format 出站映射官方参数，客户端单处定义）
        if (claim.parentProviderTaskId() != null && !stateMachine.reserveParentReuseSubmit(
                claim.id(), claim.workerId(), claim.fencingToken())) {
            return;
        }
        String taskId = extractAudioClient.submit(providerToken, source.getUrl(), outputFormat);
        log.info("[media_extract] 上游已提交 jobId={} providerTaskId={} format={}",
                claim.id(), taskId, outputFormat);

        // 4. markProviderSubmitted（视频骨架复用件：存 provider_task_id + 释放租约 + next+5s；
        //    SQL 无 type 过滤，media_extract 直接复用）
        boolean updated = stateMachine.markProviderSubmitted(
                claim.id(), claim.workerId(), claim.fencingToken(), taskId);
        if (updated) {
            scheduleNext(claim.id(), MEDIA_EXTRACT_POLL_INTERVAL_MS);
        }
    }

    // ========== poll 相 ==========

    /**
     * 轮询相：查询任务 → 瞬时错误续排 / processing 续排（含超限）/ failed 终态 /
     * completed 立即下载转存发布。
     */
    private void pollPhase(ClaimedMediaExtractJobDto claim, String providerToken) {
        ExtractAudioTaskObservation observation;
        try {
            observation = extractAudioClient.poll(providerToken, claim.providerTaskId());
        } catch (MediaExtractError pollError) {
            if (isTransientPollError(pollError)) {
                // 轮询上限对瞬时错误同样生效（IKI61M，对齐 IKI4M4 调速先例）：上游持续故障
                // （超时 / 429 / 5xx）时每次瞬时错误都走续排，poll_count 由
                // rescheduleProviderPoll 同一 SQL 累计（与 processing 分支共享预算）——
                // 若此处不判上限，poll_count 涨到 720 也进不了失败终态，卡片永远停在
                // 生成中。与 processing 分支同一判定、同一兜底码，文案附上游错误摘要（IKIHKR）。
                if (claim.pollCount() >= MAX_MEDIA_EXTRACT_POLLS) {
                    log.warn("[media_extract] 轮询瞬时错误且已达轮询上限 jobId={} pollCount={} err={}，归失败终态",
                            claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                    failMediaExtract(claim, MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED,
                            "音频提取轮询超时（超过 " + MAX_MEDIA_EXTRACT_POLLS + " 次），上游持续错误: "
                                    + pollError.getMessage());
                    return;
                }
                log.warn("[media_extract] 轮询瞬时错误 jobId={} pollCount={} err={}，重排继续轮询",
                        claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                boolean updated = stateMachine.rescheduleProviderPoll(
                        claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
                if (updated) {
                    scheduleNext(claim.id(), MEDIA_EXTRACT_POLL_INTERVAL_MS);
                }
                return;
            }
            throw pollError;
        }

        if ("processing".equals(observation.status())) {
            if (claim.pollCount() >= MAX_MEDIA_EXTRACT_POLLS) {
                // 轮询超时归并兜底码（家族口径：宁可不重试也不双跑；用户手动重试会重新提交）
                failMediaExtract(claim, MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED,
                        "音频提取轮询超时（超过 " + MAX_MEDIA_EXTRACT_POLLS + " 次）");
                return;
            }
            boolean updated = stateMachine.rescheduleProviderPoll(
                    claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
            if (updated) {
                scheduleNext(claim.id(), MEDIA_EXTRACT_POLL_INTERVAL_MS);
            }
            return;
        }

        if ("failed".equals(observation.status())) {
            // 上游可读原因透传（§18.4）；额度/内容政策信号按 §5 保留既有码（去字幕同款分类链）
            String message = observation.upstreamMessage() != null && !observation.upstreamMessage().isEmpty()
                    ? observation.upstreamMessage() : "音频提取任务失败";
            String code = classifyUpstreamFailure(observation.upstreamCode(), observation.upstreamMessage());
            log.info("[media_extract] 上游状态终态=failed jobId={} providerTaskId={} code={} pollCount={}",
                    claim.id(), claim.providerTaskId(), code, claim.pollCount());
            failMediaExtract(claim, code, message);
            return;
        }

        // completed（succeeded）
        log.info("[media_extract] 上游状态终态=completed jobId={} providerTaskId={} pollCount={}",
                claim.id(), claim.providerTaskId(), claim.pollCount());
        if (observation.audioUrl() == null || observation.audioUrl().isEmpty()) {
            failMediaExtract(claim, MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED,
                    "音频提取任务成功但未返回结果音频");
            return;
        }
        publishResult(claim, observation);
    }

    /**
     * 结果发布：立即下载转存（火山 audio_url 仅 24h 有效，官方明确「请及时下载保存」）→
     * 发布音频 Asset（type=audio / source='generated'）→ 终态 succeeded。
     * <p>
     * 返回发布守卫结果（IKI89P：重试收割据此判定复用是否成立；false = 守卫未命中，
     * 收割方停止执行不回退提交——IKICD0 统一失租与守卫未命中为停止终局）。
     */
    private boolean publishResult(ClaimedMediaExtractJobDto claim,
                                  ExtractAudioTaskObservation observation) {
        // TOS 强依赖：结果 URL 24h 失效，不允许降级直存（对齐去字幕的强依赖口径）
        if (mediaRelay == null) {
            throw new MediaExtractError(
                    MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED,
                    "音频转存存储未配置");
        }
        String outputFormat = resolveOutputFormat(claim);
        TosAudioMediaRelay.StoredAudio stored =
                mediaRelay.persist(observation.audioUrl(), claim.userId(), outputFormat);
        log.info("[media_extract] 转存完成 jobId={} storageKey={} size={}",
                claim.id(), stored.storageKey(), stored.size());

        // 时长优先官方 result.duration 精确值，缺失回落源 duration_ms 换算（去字幕同构；
        // 宽高恒 null——音频无画面维度，publishMediaExtractResult 内部落定）
        Double sourceDurationSec = null;
        String sourceAssetId = parseAssetId(
                claim.input().get(MediaExtractContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId != null) {
            AssetEntity source = assetSource.resolve(
                    Long.parseLong(sourceAssetId),
                    Long.parseLong(claim.userId()),
                    Long.parseLong(claim.projectId()));
            if (source != null && source.getDurationMs() != null) {
                sourceDurationSec = source.getDurationMs() / 1000.0;
            }
        }
        Double durationSec = observation.durationSec() != null
                ? observation.durationSec() : sourceDurationSec;

        boolean published = stateMachine.publishMediaExtractResult(new PublishMediaExtractDto(
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
                durationSec));
        if (published) {
            log.info("[media_extract] 发布成功 jobId={}", claim.id());
        } else {
            log.warn("[media_extract] 终态失败(发布守卫未命中) jobId={}（stale worker 或已终态）",
                    claim.id());
        }
        return published;
    }

    // ========== 瞬时轮询错误判定（视频骨架 isTransientPollError 同语义） ==========

    /**
     * 瞬时轮询错误判定（去字幕 isTransientPollError 同语义）：网络超时 / 不可达 → 瞬时；
     * HTTP 429/5xx（cause 携带状态）→ 瞬时；4xx 与业务失败 → 非瞬时。
     */
    static boolean isTransientPollError(MediaExtractError error) {
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

    /** 转存扩展名取任务所选 output_format（提交相已校验枚举；poll 相冻结 input 原样沿用）。 */
    private static String resolveOutputFormat(ClaimedMediaExtractJobDto claim) {
        Object formatObj = claim.input().get(MediaExtractContract.INPUT_KEY_OUTPUT_FORMAT);
        if (formatObj instanceof String format
                && MediaExtractContract.SUPPORTED_OUTPUT_FORMATS.contains(format)) {
            return format;
        }
        return MediaExtractContract.DEFAULT_OUTPUT_FORMAT;
    }

    /**
     * 失败码归一（§18.4）：§5 分类信号（额度/内容政策）保留既有码，其余一律归并兜底
     * media_extract_provider_failed（1044，与本地 ffmpeg 兜底 1020 区分——ADR-0103）。
     */
    private static String resolveFailCode(Exception e) {
        if (e instanceof MediaExtractError mee && PRESERVED_ERROR_CODES.contains(mee.getCode())) {
            return mee.getCode();
        }
        return MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED;
    }

    /**
     * 上游任务 failed 的错误码分类（§5 优先级；去字幕分类链同款：
     * 版权 → 内容政策 → 额度 → 兜底 1044）。
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
        return MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED;
    }

    /** 失败处理（沿用既有 failMediaExtractJob 守卫：SET 清 next_action_at + next_poll_at，
     *  轮询型任务语义完备；details.raw 透传原始原因）。 */
    private void failMediaExtract(ClaimedMediaExtractJobDto claim, String code, String message) {
        log.warn("media_extract job 失败 jobId={} code={} message={}", claim.id(), code, message);
        Map<String, Object> details = new HashMap<>();
        details.put("raw", message);
        stateMachine.failMediaExtractJob(new FailMediaExtractDto(
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
            log.error("[media_extract] scheduleNext MQ 发送失败 jobId={} delayMs={}: {}",
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
