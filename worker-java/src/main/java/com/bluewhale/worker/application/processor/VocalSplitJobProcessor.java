package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedVocalSplitJobDto;
import com.bluewhale.worker.domain.dto.FailMediaExtractDto;
import com.bluewhale.worker.domain.dto.PublishVocalSplitDto;
import com.bluewhale.worker.domain.dto.PublishVocalSplitDto.PublishVocalSplitTrackDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.VocalSplitContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VocalSplitError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSeparateVoiceClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSeparateVoiceClient.SeparateVoiceTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosAudioMediaRelay;
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
 * vocal_split（人声背景分离）作业处理器——火山 MediaKit 异步链（IKHA2J；契约 =
 * backend/libs/contracts/vocal-split.ts）。编排骨架对齐 {@link MediaExtractJobProcessor}
 * （每步 = 一次 MQ 消费，视频轮询骨架复用）：
 * <ol>
 *   <li>claimVocalSplit（source 白名单单值 vocal_split；富投影：providerTaskId /
 *       pollCount / progress）</li>
 *   <li>providerTaskId==null → 解析冻结 input + 源素材（视频或音频 Asset，官方双协议输入）→
 *       网关提交（scene 出站映射官方首字母大写枚举 + output_format 同名同值，**不是
 *       extract-audio 的 format**）→ markProviderSubmitted（存 provider_task_id + 释放租约 +
 *       next+5s + progress=1）→ scheduleNext(5s)</li>
 *   <li>providerTaskId!=null → 查询任务 → 瞬时错误 rescheduleProviderPoll 续排（与
 *       processing 共享 720 轮询预算，超限同归 1047）；processing →
 *       续排（超限 1047）；failed → 分类终态；completed → **逐轨立即下载转存自家 TOS
 *       （火山各轨 URL 仅 24h 有效）** → 按 scene 轨序发布 2/3 条音频 Asset → 终态 succeeded
 *       （轨数组回填终态日志 payload，getStatus 投影见契约 VocalSplitTrackResult）</li>
 * </ol>
 * 多轨发布面（与单轨先例的契约差异）：scene 二分法（audio/music）两轨 voice+background、
 * 三分法（drama/narrate）三轨 voice+music+sfx；轨序单源 {@link VocalSplitContract#SCENE_TRACKS}，
 * 按轨序逐轨 persist + 单事务发布，output_asset_ids 按轨序拼 JSON 数组；官方 result 缺任一
 * 轨 URL 或任一轨转存失败 → 整单失败（1047，无部分成功口径）。
 * <p>
 * 错误码口径（契约尾注三类映射，无 worker 级自动重试，用户手动重试沿用冻结 input）：
 * <ul>
 *   <li>provider_credential_missing：任务缺少冻结凭证（家族同构；凭证冻结在创建入口）</li>
 *   <li>invalid_input：业务键缺失 / scene / output_format 枚举外（创建入口复核是权威，
 *       worker 兜底防御）</li>
 *   <li>content_rejected / content_rejected_reference / quota_exhausted：NewApiErrorClassifier
 *       §5 分类信号（网关错误与火山 failed 双路），保留既有码投影</li>
 *   <li>vocal_split_failed（1047）：其余一律归并兜底——网关 provider_failed / 提交超时 /
 *       轮询超时 / 火山任务 failed（含 scene 门槛等供应商侧拒绝）/ 源素材不可用 / 结果缺轨 /
 *       转存失败（超时也归并是家族口径：宁可不重试也不双跑），上游可读原因随 message
 *       透传前端投影</li>
 * </ul>
 * <p>
 * 进度口径对齐家族：markProviderSubmitted 落 progress=1（SQL 侧）、轮询 rescheduleProviderPoll
 * 保持不倒退、publishVocalSplitResult 终态 progress=100。
 */
@Component
public class VocalSplitJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(VocalSplitJobProcessor.class);

    /** §5 分类信号白名单：这些既有码直接投影，其余全部归并 vocal_split_failed(1047)。 */
    private static final Set<String> PRESERVED_ERROR_CODES = Set.of(
            GenerationError.ERROR_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    /** 轮询步调 5s（家族 MEDIA_EXTRACT_POLL_INTERVAL_MS / 去字幕同值）。 */
    public static final long VOCAL_SPLIT_POLL_INTERVAL_MS = 5_000;

    /** 轮询上限 720 次 ≈ 60 分钟（家族 MAX_MEDIA_EXTRACT_POLLS 同值：人声分离为音频
     *  分离型任务，耗时上界与抽轨转换同量级，60 分钟窗口覆盖产品上限内最长任务）。 */
    public static final int MAX_VOCAL_SPLIT_POLLS = 720;

    private final JobStateMachineService stateMachine;
    private final AssetSourceService assetSource;
    private final GenerationCredentialService credentialService;
    private final NewApiMediaKitSeparateVoiceClient separateVoiceClient;
    private final TosAudioMediaRelay mediaRelay;
    private final GenerationMessageProducer producer;
    private final String workerId;

    public VocalSplitJobProcessor(
            JobStateMachineService stateMachine,
            AssetSourceService assetSource,
            GenerationCredentialService credentialService,
            NewApiMediaKitSeparateVoiceClient separateVoiceClient,
            TosAudioMediaRelay mediaRelay,
            @Qualifier("vocalSplitMessageProducer")
            GenerationMessageProducer producer
    ) {
        this.stateMachine = stateMachine;
        this.assetSource = assetSource;
        this.credentialService = credentialService;
        this.separateVoiceClient = separateVoiceClient;
        this.mediaRelay = mediaRelay;
        this.producer = producer;
        // workerId = vocal-split-{hostname}-{pid}（家族 extract- 前缀同款）
        this.workerId = "vocal-split-" + hostname() + "-" + ProcessHandle.current().pid();
    }

    @Override
    public String tag() {
        return VocalSplitContract.TAG;
    }

    /**
     * 处理一个 vocal_split job step（每步 = 一次 MQ 消费）。
     * <p>
     * claim 在 try 外（家族口径：DB 异常上抛 → consumer 不 ack → 重投）；
     * 业务失败一律落终态 failed（无自动重试）。
     */
    @Override
    public void handle(String jobId) {
        Optional<ClaimedVocalSplitJobDto> claimOpt;
        try {
            claimOpt = stateMachine.claimVocalSplit(jobId, workerId);
        } catch (Exception error) {
            log.error("[vocal_split] claim 失败 jobId={}: {}",
                    jobId, error.getMessage(), error);
            throw error; // 保持不 ack → RocketMQ 重投
        }
        if (claimOpt.isEmpty()) return; // 无可认领 / 重复唤醒

        ClaimedVocalSplitJobDto claim = claimOpt.get();
        log.info("[vocal_split] 已领取 jobId={} token={} providerTaskId={} pollCount={}",
                claim.id(), claim.fencingToken(), claim.providerTaskId(), claim.pollCount());

        try {
            runStep(claim);
        } catch (Exception e) {
            String code = resolveFailCode(e);
            String message = e.getMessage() != null ? e.getMessage() : "人声背景分离失败";
            log.error("[vocal_split] 终态失败 jobId={} code={}: {}", claim.id(), code, message, e);
            failVocalSplit(claim, code, message);
        }
    }

    /**
     * 分相主逻辑（家族 runStep 同构）：凭证 → submit 相 / poll 相。
     */
    private void runStep(ClaimedVocalSplitJobDto claim) {
        // 取明文凭证（家族同构；冻结在创建入口）
        Object credentialObj = claim.input().get("provider_credential");
        if (!(credentialObj instanceof String providerCredential) || providerCredential.isEmpty()) {
            failVocalSplit(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "人声背景分离任务缺少供应商凭证");
            return;
        }
        String providerToken;
        try {
            providerToken = credentialService.open(providerCredential);
        } catch (Exception e) {
            log.debug("[vocal_split] 凭证无效 jobId={}: {}", claim.id(), e.getMessage(), e);
            failVocalSplit(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "人声背景分离任务凭证无效");
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
     * 提交相：解析冻结 input + 源素材 → 网关提交（scene 出站映射 + output_format）→
     * markProviderSubmitted → 续排轮询。
     */
    private void submitPhase(ClaimedVocalSplitJobDto claim, String providerToken) {
        // 0. IKI89R（ADR-0114）：重试收割——retry job 先查父任务上游，命中则不重新提交
        //    （IKI8GN：骨架收敛至 ParentResultReuse，家族差异=齐全判定/发布入口以参数表达）
        if (claim.parentProviderTaskId() != null) {
            if (ParentResultReuse.tryReuseParentResult(VocalSplitContract.TAG, claim, providerToken,
                    separateVoiceClient::poll,
                    this::vocalSplitResultIncomplete,
                    this::publishResult)) {
                return;
            }
        }

        Map<String, Object> input = claim.input();

        // 1. 解析冻结 input 业务键（三键恒在、值恒为合法枚举，创建时定死；此处为
        //    worker 兜底防御，权威复核在创建入口）
        String sourceAssetId = parseAssetId(input.get(VocalSplitContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId == null) {
            failVocalSplit(claim, GenerationError.ERROR_INVALID_INPUT, "缺少源素材资产 id");
            return;
        }
        Object sceneObj = input.get(VocalSplitContract.INPUT_KEY_SCENE);
        if (!(sceneObj instanceof String scene)
                || !VocalSplitContract.SUPPORTED_SCENES.contains(scene)) {
            failVocalSplit(claim, GenerationError.ERROR_INVALID_INPUT, "人声背景分离场景非法");
            return;
        }
        Object formatObj = input.get(VocalSplitContract.INPUT_KEY_OUTPUT_FORMAT);
        if (!(formatObj instanceof String outputFormat)
                || !VocalSplitContract.SUPPORTED_OUTPUT_FORMATS.contains(outputFormat)) {
            failVocalSplit(claim, GenerationError.ERROR_INVALID_INPUT, "人声背景分离输出格式非法");
            return;
        }

        // 2. 解析源素材：人声分离输入支持视频与纯音频（官方双协议 video_url / audio_url，
        //    Asset url 落库即公网 public-read，家族同构）
        AssetEntity source = assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.userId()),
                Long.parseLong(claim.projectId()));
        boolean sourceIsVideo = source != null && "video".equals(source.getType());
        boolean sourceIsAudio = source != null && "audio".equals(source.getType());
        if ((!sourceIsVideo && !sourceIsAudio) || source.getUrl() == null || source.getUrl().isEmpty()) {
            failVocalSplit(claim, VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED,
                    "源素材不可用（仅支持视频或音频）");
            return;
        }

        // 3. 网关提交异步任务（scene 经契约 SCENE_UPSTREAM_MAP 换算官方首字母大写枚举，
        //    出站键是 scene + output_format，客户端单处定义）
        String taskId = separateVoiceClient.submit(
                providerToken, source.getUrl(), sourceIsVideo, scene, outputFormat);
        log.info("[vocal_split] 上游已提交 jobId={} providerTaskId={} scene={} format={}",
                claim.id(), taskId, scene, outputFormat);

        // 4. markProviderSubmitted（视频骨架复用件：存 provider_task_id + 释放租约 + next+5s +
        //    progress=1；SQL 无 type 过滤，家族直接复用）
        boolean updated = stateMachine.markProviderSubmitted(
                claim.id(), claim.workerId(), claim.fencingToken(), taskId);
        if (updated) {
            scheduleNext(claim.id(), VOCAL_SPLIT_POLL_INTERVAL_MS);
        }
    }

    /**
     * 收割齐全判定（IKI8GN 家族差异参数）：轨数组齐全口径对齐轮询相成功判据——scene 轨序内
     * 每轨 URL 都在（客户端只装非空 URL，containsKey 即齐全；缺任一轨 = 不齐全，不部分复用）。
     * 返回 null=齐全；非空=未齐原因短句（嵌进共享骨架「未命中(父任务{})」日志）。
     */
    private String vocalSplitResultIncomplete(ClaimedVocalSplitJobDto claim,
                                              SeparateVoiceTaskObservation observation) {
        Map<String, String> trackUrls = observation.trackUrls() != null
                ? observation.trackUrls() : Map.of();
        for (String trackType : resolveTrackOrder(claim)) {
            if (!trackUrls.containsKey(trackType)) {
                return "轨数组不齐，缺" + trackType + "轨";
            }
        }
        return null;
    }

    // ========== poll 相 ==========

    /**
     * 轮询相：查询任务 → 瞬时错误续排 / processing 续排（含超限）/ failed 终态 /
     * completed 逐轨立即下载转存发布。
     */
    private void pollPhase(ClaimedVocalSplitJobDto claim, String providerToken) {
        SeparateVoiceTaskObservation observation;
        try {
            observation = separateVoiceClient.poll(providerToken, claim.providerTaskId());
        } catch (VocalSplitError pollError) {
            if (isTransientPollError(pollError)) {
                // 轮询上限对瞬时错误同样生效（IKI61M，对齐 IKI4M4 调速先例）：上游持续故障
                // （超时 / 429 / 5xx）时每次瞬时错误都走续排，poll_count 由
                // rescheduleProviderPoll 同一 SQL 累计（与 processing 分支共享预算）——
                // 若此处不判上限，poll_count 涨到 720 也进不了失败终态，卡片永远停在
                // 生成中。与 processing 分支同一判定、同一兜底码、同一文案。
                if (claim.pollCount() >= MAX_VOCAL_SPLIT_POLLS) {
                    log.warn("[vocal_split] 轮询瞬时错误且已达轮询上限 jobId={} pollCount={} err={}，归失败终态",
                            claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                    failVocalSplit(claim, VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED,
                            "人声背景分离轮询超时（超过 " + MAX_VOCAL_SPLIT_POLLS + " 次）");
                    return;
                }
                log.warn("[vocal_split] 轮询瞬时错误 jobId={} pollCount={} err={}，重排继续轮询",
                        claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                boolean updated = stateMachine.rescheduleProviderPoll(
                        claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
                if (updated) {
                    scheduleNext(claim.id(), VOCAL_SPLIT_POLL_INTERVAL_MS);
                }
                return;
            }
            throw pollError;
        }

        if ("processing".equals(observation.status())) {
            if (claim.pollCount() >= MAX_VOCAL_SPLIT_POLLS) {
                // 轮询超时归并兜底码（家族口径：宁可不重试也不双跑；用户手动重试会重新提交）
                failVocalSplit(claim, VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED,
                        "人声背景分离轮询超时（超过 " + MAX_VOCAL_SPLIT_POLLS + " 次）");
                return;
            }
            boolean updated = stateMachine.rescheduleProviderPoll(
                    claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
            if (updated) {
                scheduleNext(claim.id(), VOCAL_SPLIT_POLL_INTERVAL_MS);
            }
            return;
        }

        if ("failed".equals(observation.status())) {
            // 上游可读原因透传（契约兜底码口径）；额度/内容政策信号按 §5 保留既有码（家族分类链）
            String message = observation.upstreamMessage() != null && !observation.upstreamMessage().isEmpty()
                    ? observation.upstreamMessage() : "人声背景分离任务失败";
            String code = classifyUpstreamFailure(observation.upstreamCode(), observation.upstreamMessage());
            log.info("[vocal_split] 上游状态终态=failed jobId={} providerTaskId={} code={} pollCount={}",
                    claim.id(), claim.providerTaskId(), code, claim.pollCount());
            failVocalSplit(claim, code, message);
            return;
        }

        // completed（succeeded）
        log.info("[vocal_split] 上游状态终态=completed jobId={} providerTaskId={} pollCount={} trackUrls={}",
                claim.id(), claim.providerTaskId(), claim.pollCount(),
                observation.trackUrls() != null ? observation.trackUrls().keySet() : null);
        publishResult(claim, observation);
    }

    /**
     * 结果发布：按 scene 轨序逐轨立即下载转存（火山各轨 URL 仅 24h 有效，官方明确
     * 「有效期 24 小时」）→ 单事务发布 2/3 条音频 Asset（type=audio / source='generated'）→
     * 终态 succeeded（轨数组回填终态日志 payload，字段 = 契约 VocalSplitTrackResult）。
     * <p>
     * 缺任一轨 URL / 任一轨转存失败 → 整单失败（契约口径：无部分成功；已转存的 TOS 对象
     * 随失败留弃，与家族单轨转存失败的孤儿口径一致）。
     * <p>
     * 返回发布守卫结果（IKI89R：重试收割据此判定复用是否成立，false 回退正常重新提交）。
     */
    private boolean publishResult(ClaimedVocalSplitJobDto claim,
                                  SeparateVoiceTaskObservation observation) {
        // TOS 强依赖：结果 URL 24h 失效，不允许降级直存（家族强依赖口径）
        if (mediaRelay == null) {
            throw new VocalSplitError(
                    VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED,
                    "音频转存存储未配置");
        }

        // 轨序单源契约 SCENE_TRACKS（voice 恒首轨）；官方 result 缺任一轨 → 整单失败
        List<String> trackOrder = resolveTrackOrder(claim);
        Map<String, String> trackUrls = observation.trackUrls() != null
                ? observation.trackUrls() : Map.of();
        for (String trackType : trackOrder) {
            if (!trackUrls.containsKey(trackType)) {
                throw new VocalSplitError(VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED,
                        "人声背景分离任务成功但缺少 " + trackType + " 轨结果");
            }
        }

        String outputFormat = resolveOutputFormat(claim);

        // 时长优先官方 result.duration 精确值，缺失回落源 duration_ms 换算（家族同构；
        // 官方 duration 是单值，逐轨冗余同一值，契约结构自包含）
        Double durationSec = observation.durationSec() != null
                ? observation.durationSec() : resolveSourceDurationSec(claim);

        // 逐轨转存（轨序展开；任一失败整单失败——由 handle 统一归并 1047）
        List<PublishVocalSplitTrackDto> tracks = new ArrayList<>(trackOrder.size());
        for (String trackType : trackOrder) {
            TosAudioMediaRelay.StoredAudio stored =
                    mediaRelay.persist(trackUrls.get(trackType), claim.userId(), outputFormat);
            log.info("[vocal_split] 转存完成 jobId={} track={} storageKey={} size={}",
                    claim.id(), trackType, stored.storageKey(), stored.size());
            tracks.add(new PublishVocalSplitTrackDto(
                    trackType, stored.url(), stored.storageKey(), stored.mime(),
                    stored.size(), stored.md5(), durationSec));
        }

        boolean published = stateMachine.publishVocalSplitResult(new PublishVocalSplitDto(
                claim.id(),
                claim.projectId(),
                claim.userId(),
                claim.workerId(),
                claim.fencingToken(),
                tracks));
        if (published) {
            log.info("[vocal_split] 发布成功 jobId={} tracks={}", claim.id(), trackOrder);
        } else {
            log.warn("[vocal_split] 终态失败(发布守卫未命中) jobId={}（stale worker 或已终态）",
                    claim.id());
        }
        return published;
    }

    // ========== 瞬时轮询错误判定（视频骨架 isTransientPollError 同语义） ==========

    /**
     * 瞬时轮询错误判定（家族同语义）：网络超时 / 不可达 → 瞬时；HTTP 429/5xx（cause 携带
     * 状态）→ 瞬时；4xx 与业务失败 → 非瞬时。
     */
    static boolean isTransientPollError(VocalSplitError error) {
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

    /** Asset id 容忍数字形态（Jackson 数字 JSON 值），家族解析同构。 */
    private static String parseAssetId(Object obj) {
        if (obj instanceof String s && !s.isEmpty()) return s;
        if (obj instanceof Number n) return String.valueOf(n.longValue());
        return null;
    }

    /** 轨序取任务冻结 scene 的契约轨序（2/3 轨；scene 非法回落默认场景，创建入口已复核）。 */
    private static List<String> resolveTrackOrder(ClaimedVocalSplitJobDto claim) {
        Object sceneObj = claim.input().get(VocalSplitContract.INPUT_KEY_SCENE);
        String scene = sceneObj instanceof String s ? s : null;
        if (scene == null || !VocalSplitContract.SCENE_TRACKS.containsKey(scene)) {
            scene = VocalSplitContract.DEFAULT_SCENE;
        }
        return VocalSplitContract.SCENE_TRACKS.get(scene);
    }

    /** 转存扩展名取任务所选 output_format（提交相已校验枚举；poll 相冻结 input 原样沿用）。 */
    private static String resolveOutputFormat(ClaimedVocalSplitJobDto claim) {
        Object formatObj = claim.input().get(VocalSplitContract.INPUT_KEY_OUTPUT_FORMAT);
        if (formatObj instanceof String format
                && VocalSplitContract.SUPPORTED_OUTPUT_FORMATS.contains(format)) {
            return format;
        }
        return VocalSplitContract.DEFAULT_OUTPUT_FORMAT;
    }

    /** 源素材时长回落（官方 duration 缺失时用源 duration_ms 换算秒；解析失败回 null）。 */
    private Double resolveSourceDurationSec(ClaimedVocalSplitJobDto claim) {
        String sourceAssetId = parseAssetId(
                claim.input().get(VocalSplitContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId == null) {
            return null;
        }
        AssetEntity source = assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.userId()),
                Long.parseLong(claim.projectId()));
        if (source != null && source.getDurationMs() != null) {
            return source.getDurationMs() / 1000.0;
        }
        return null;
    }

    /**
     * 失败码归一（契约尾注）：§5 分类信号（额度/内容政策）保留既有码，其余一律归并兜底
     * vocal_split_failed（1047）。
     */
    private static String resolveFailCode(Exception e) {
        if (e instanceof VocalSplitError vse && PRESERVED_ERROR_CODES.contains(vse.getCode())) {
            return vse.getCode();
        }
        return VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED;
    }

    /**
     * 上游任务 failed 的错误码分类（§5 优先级；家族分类链同款：
     * 版权 → 内容政策 → 额度 → 兜底 1047）。
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
        return VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED;
    }

    /** 失败处理（复用家族 failMediaExtractJob 守卫：SET 清 next_action_at + next_poll_at，
     *  轮询型任务语义完备；details.raw 透传原始原因——跨工具复用同款守卫，video_enhance
     *  复用 failVideoJob 同例）。 */
    private void failVocalSplit(ClaimedVocalSplitJobDto claim, String code, String message) {
        log.warn("vocal_split job 失败 jobId={} code={} message={}", claim.id(), code, message);
        Map<String, Object> details = new HashMap<>();
        details.put("raw", message);
        stateMachine.failVocalSplitJob(new FailMediaExtractDto(
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
            log.error("[vocal_split] scheduleNext MQ 发送失败 jobId={} delayMs={}: {}",
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
