package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedVideoJobDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoInputError;
import com.bluewhale.worker.domain.error.VideoProviderError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.SubmitResult;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.VideoReference;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.VideoSubmitInput;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient.VideoTaskObservation;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay.StoredVideo;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 视频作业处理器（video-job-runner.ts:195-376 runVideoJobStep 逐字移植）。
 * <p>
 * 编排流程（与音频/图片不同：视频是多步状态机，每步 = 一次 MQ 消费）：
 * <ol>
 *   <li>claimVideoJobById（富投影：pollCount/progress/providerTaskId/parentProviderTaskId）</li>
 *   <li>cancelRequested AND providerTaskId==null → cancelVideoBeforeDispatch</li>
 *   <li>providerTaskId==null → (a) parent-reuse 防双扣 → (b) buildSubmitRequest → submit →
 *       markVideoSubmitted → scheduleNext(5s)</li>
 *   <li>providerTaskId!=null → poll → transient → rescheduleVideoPoll(5s);
 *       pollCount>=720 → provider_timeout; succeeded+URL → relay → publishVideoResult;
 *       failed → failVideoJob</li>
 * </ol>
 * <p>
 * 错误码映射（附录 A video + video-job-runner.ts:357-375）：
 * <ul>
 *   <li>provider_credential_missing：缺少密封凭证 (:218-221)</li>
 *   <li>invalid_input：参数无效（buildSubmitRequest :598-606）</li>
 *   <li>invalid_reference / invalid_reference_type / invalid_reference_media / unsupported_input /
 *       reference_asset_unavailable / reference_limit_exceeded：参考校验</li>
 *   <li>provider_timeout：轮询超限 720 次 (:272-279)</li>
 *   <li>provider_failed：兜底 catch-all (:360-365)</li>
 *   <li>VideoProviderError.code：provider 层分类透传</li>
 *   <li>VideoInputError.code：输入校验码透传</li>
 * </ul>
 * <p>
 * 修正一：cost_reservations / actual_amount_fen / release_note 整体省略。
 * quota 偏差告警段 (:317-339) 保留注释但不实现（无 quotaToFen）。
 * <p>
 * 修正三：ARK provider 不移植——new-api 网关是唯一 provider。
 */
@Component
public class VideoJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(VideoJobProcessor.class);

    /** 视频轮询内循环步调 ms（video-job-runner.ts:36 VIDEO_POLL_INTERVAL_MS）。 */
    public static final long VIDEO_POLL_INTERVAL_MS = 5_000;

    /** 视频轮询超限（video-job-runner.ts:38 MAX_VIDEO_POLLS = 720 ≈ 60 分钟）。 */
    public static final int MAX_VIDEO_POLLS = 720;

    // ========== 参考视频校验常量（video-reference-validation.ts:11-21） ==========

    static final int MAX_REFERENCE_IMAGES = 9;
    static final int MAX_REFERENCE_VIDEOS = 3;
    static final long MAX_REFERENCE_VIDEO_BYTES = 200L * 1024 * 1024;
    static final int MAX_REFERENCE_VIDEO_SECONDS = 15;
    static final int MIN_REFERENCE_VIDEO_SIDE = 300;
    static final int MAX_REFERENCE_VIDEO_SIDE = 6000;
    static final int MIN_REFERENCE_VIDEO_PIXELS = 409_600;
    static final int MAX_REFERENCE_VIDEO_PIXELS = 8_295_044;
    static final double MIN_REFERENCE_VIDEO_RATIO = 0.4;
    static final double MAX_REFERENCE_VIDEO_RATIO = 2.5;
    static final Set<String> REFERENCE_VIDEO_MIMES = Set.of("video/mp4", "video/quicktime");

    /** Seedance 2.0 模型识别（video-reference-validation.ts:166-168）。 */
    static final Pattern SEEDANCE2_PATTERN = Pattern.compile(
            "^seedance-2$|^doubao-seedance-2-0(?:-|$)");

    /** resolution → height 解析（video-dimensions.ts:8）。 */
    private static final Pattern RESOLUTION_PATTERN = Pattern.compile("^([0-9]+)p$");
    /** aspect_ratio → w:h 解析（video-dimensions.ts:9）。 */
    private static final Pattern RATIO_PATTERN = Pattern.compile("^([1-9][0-9]*):([1-9][0-9]*)$");
    /** size → WxH 解析（video-dimensions.ts:18）。 */
    private static final Pattern SIZE_PATTERN = Pattern.compile("^([0-9]+)x([0-9]+)$", Pattern.CASE_INSENSITIVE);

    private final JobStateMachineService stateMachine;
    private final AssetSourceService assetSource;
    private final GenerationCredentialService credentialService;
    private final NewApiVideoClient videoClient;
    private final TosVideoMediaRelay mediaRelay;
    private final GenerationMessageProducer producer;
    private final String workerId;

    public VideoJobProcessor(
            JobStateMachineService stateMachine,
            AssetSourceService assetSource,
            GenerationCredentialService credentialService,
            NewApiVideoClient videoClient,
            TosVideoMediaRelay mediaRelay,
            GenerationMessageProducer producer
    ) {
        this.stateMachine = stateMachine;
        this.assetSource = assetSource;
        this.credentialService = credentialService;
        this.videoClient = videoClient;
        this.mediaRelay = mediaRelay;
        this.producer = producer;
        this.workerId = "video-" + hostname() + "-" + ProcessHandle.current().pid();
    }

    @Override
    public String tag() {
        return "step";
    }

    /**
     * 处理一个视频 step（video-job-runner.ts:195-376 runVideoJobStep）。
     * <p>
     * claim 在 try 外（DB 异常上抛 → consumer 不 ack → 重投）。
     */
    @Override
    public void handle(String jobId) {
        // 1. claim（video-job-runner.ts:208-211）
        Optional<ClaimedVideoJobDto> claimOpt;
        try {
            claimOpt = stateMachine.claimVideoJobById(jobId, workerId);
        } catch (Exception error) {
            log.error("claimVideoJobById 失败 jobId={}: {}", jobId, error.getMessage());
            throw error;
        }
        if (claimOpt.isEmpty()) return;

        ClaimedVideoJobDto claim = claimOpt.get();

        // 2. cancel before dispatch（video-job-runner.ts:213-216）
        if (claim.cancelRequested() && claim.providerTaskId() == null) {
            stateMachine.cancelVideoBeforeDispatch(claim.id(), claim.workerId(), claim.fencingToken());
            return;
        }

        // 3. 解封凭证（video-job-runner.ts:218-222）
        Object sealedObj = claim.input().get("provider_credential");
        if (!(sealedObj instanceof String sealedCredential) || sealedCredential.isEmpty()) {
            failVideo(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "视频任务缺少供应商凭证");
            return;
        }
        String providerToken;
        try {
            providerToken = credentialService.open(sealedCredential);
        } catch (Exception e) {
            failVideo(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "视频任务凭证解密失败");
            return;
        }

        try {
            runVideoStep(claim, providerToken);
        } catch (Exception error) {
            // video-job-runner.ts:357-375 catch
            String code;
            String message;
            if (error instanceof VideoInputError vie) {
                code = vie.getCode();
                message = vie.getMessage();
            } else if (error instanceof VideoProviderError vpe) {
                code = vpe.getCode();
                message = vpe.getMessage();
            } else {
                code = GenerationError.ERROR_PROVIDER_FAILED;
                message = error.getMessage() != null ? error.getMessage() : "视频生成失败";
            }
            log.error("runVideoJobStep 异常 jobId={} code={}: {}", claim.id(), code, message, error);
            failVideo(claim, code, message);
        }
    }

    /**
     * 视频步骤主逻辑（video-job-runner.ts:224-356 try 块）。
     */
    private void runVideoStep(ClaimedVideoJobDto claim, String providerToken) {
        if (claim.providerTaskId() == null) {
            // ========== submit 阶段（video-job-runner.ts:226-243）==========

            // IKEA26：parent-reuse 防双扣（:232-235）
            if (claim.parentProviderTaskId() != null) {
                boolean reused = tryReuseParentResult(claim, providerToken);
                if (reused) return;
            }

            // buildSubmitRequest（:236）
            VideoSubmitInput request = buildSubmitRequest(claim);

            // submit（:237）
            SubmitResult submitted = videoClient.submit(providerToken, request);

            // markVideoSubmitted（:238-242）
            boolean updated = stateMachine.markVideoSubmitted(
                    claim.id(), claim.workerId(), claim.fencingToken(), submitted.taskId());
            if (updated) {
                scheduleNext(claim.id(), VIDEO_POLL_INTERVAL_MS);
            }
        } else {
            // ========== poll 阶段（video-job-runner.ts:246-355）==========
            pollPhase(claim, providerToken);
        }
    }

    /**
     * poll 阶段（video-job-runner.ts:249-355）。
     */
    private void pollPhase(ClaimedVideoJobDto claim, String providerToken) {
        VideoTaskObservation observation;
        try {
            observation = videoClient.poll(providerToken, claim.providerTaskId());
        } catch (VideoProviderError pollError) {
            // isTransientPollError（video-job-runner.ts:386-413）
            if (isTransientPollError(pollError)) {
                log.warn("video job 轮询瞬时错误 jobId={} pollCount={} err={}，重排继续轮询（IKEA26）",
                        claim.id(), claim.pollCount(), pollError.getMessage());
                boolean updated = stateMachine.rescheduleVideoPoll(
                        claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
                if (updated) {
                    scheduleNext(claim.id(), VIDEO_POLL_INTERVAL_MS);
                }
                return;
            }
            throw pollError;
        }

        if ("queued".equals(observation.status()) || "processing".equals(observation.status())) {
            // video-job-runner.ts:266-286
            log.debug("video job 轮询中 jobId={} status={} progress={}",
                    claim.id(), observation.status(), observation.progress());

            // poll 超限 → provider_timeout（:272-279）
            if (claim.pollCount() >= MAX_VIDEO_POLLS) {
                failVideo(claim, GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "视频生成轮询超时（超过 " + MAX_VIDEO_POLLS + " 次）");
                return;
            }

            boolean updated = stateMachine.rescheduleVideoPoll(
                    claim.id(), claim.workerId(), claim.fencingToken(), observation.progress());
            if (updated) {
                scheduleNext(claim.id(), VIDEO_POLL_INTERVAL_MS);
            }
            return;
        }

        if ("failed".equals(observation.status())) {
            // video-job-runner.ts:288-295
            String code = observation.error() != null && observation.error().code() != null
                    ? observation.error().code() : GenerationError.ERROR_PROVIDER_FAILED;
            String message = observation.error() != null && observation.error().message() != null
                    ? observation.error().message() : "视频生成失败";
            failVideo(claim, code, message);
            return;
        }

        // succeeded（:297-355）
        if (observation.url() == null || observation.url().isEmpty()) {
            // video-job-runner.ts:297-299
            failVideo(claim, GenerationError.ERROR_PROVIDER_FAILED, "视频任务成功但未返回 URL");
            return;
        }

        // relay + publish（video-job-runner.ts:302-355）
        publishVideo(claim, observation);
    }

    /**
     * IKEA26：parent-reuse 防双扣（video-job-runner.ts:424-453 tryReuseParentResult）。
     * <p>
     * 父 job 的 provider_task_id 对应的上游 task SUCCESS → 复用其结果 URL 走 publishVideoResult。
     * FAILED / 不存在 / 查询失败 → 返回 false（走现有 submit 逻辑重新生成）。
     */
    private boolean tryReuseParentResult(ClaimedVideoJobDto claim, String providerToken) {
        VideoTaskObservation observation;
        try {
            observation = videoClient.poll(providerToken, claim.parentProviderTaskId());
        } catch (Exception error) {
            // D6：查询失败 → 当不存在（video-job-runner.ts:441-446）
            log.warn("video job 重试查上游失败 jobId={} parentTask={} err={}，按不存在处理重新 submit（IKEA26）",
                    claim.id(), claim.parentProviderTaskId(), error.getMessage());
            return false;
        }

        if (!"succeeded".equals(observation.status()) || observation.url() == null) {
            return false;
        }

        // 复用结果 → publishVideo（:448-452）
        boolean published = publishVideo(claim, observation);
        if (!published) {
            log.warn("video job 复用结果 publish 但状态未迁移 jobId={}（fencing 竞态？）", claim.id());
        }
        return published;
    }

    /**
     * 视频结果发布（video-job-runner.ts:457-528 publishVideo）。
     * <p>
     * relay.persist → videoDimensions → publishVideoResult。
     * <p>
     * 修正一：quota/actualAmountFen 偏差告警段整体省略。
     */
    private boolean publishVideo(ClaimedVideoJobDto claim, VideoTaskObservation observation) {
        // relay persist（:468）
        StoredVideo stored;
        if (mediaRelay != null) {
            stored = mediaRelay.persist(observation.url(), claim.user_id());
        } else {
            // TOS 未配置 → 降级直存 URL（与 image 同构）
            stored = new StoredVideo(observation.url(), null, null, null);
        }

        // videoDimensions（:469-476）
        int[] dimensions = resolveDimensions(claim.input());
        if (dimensions == null) {
            failVideo(claim, GenerationError.ERROR_INVALID_INPUT, "视频尺寸无效");
            return false;
        }

        // duration（:510）
        double duration = resolveDuration(claim.input());

        // publishVideoResult（:504-512）
        return stateMachine.publishVideoResult(
                claim.id(), claim.project_id(), claim.user_id(),
                claim.workerId(), claim.fencingToken(),
                stored.url(), stored.storageKey(), stored.mime(), stored.size(),
                dimensions[0], dimensions[1], duration);
    }

    /**
     * 失败处理（video-job-runner.ts:530-558 fail）。
     */
    private void failVideo(ClaimedVideoJobDto claim, String code, String message) {
        log.warn("video job 失败 jobId={} code={} message={}", claim.id(), code, message);
        Map<String, Object> details = new HashMap<>();
        details.put("raw", message);
        // 修正一：releaseNote 整体省略（video-job-runner.ts:545 releaseNote 参数删除）
        stateMachine.failJob(claim.id(), code, message, details, claim.workerId(), claim.fencingToken());
    }

    /**
     * MQ 自投延迟消息（video-queue.ts:54-62 enqueue）。
     */
    private void scheduleNext(String jobId, long delayMs) {
        try {
            producer.enqueue(jobId, delayMs);
        } catch (Exception e) {
            log.error("视频 scheduleNext 失败 jobId={}: {}", jobId, e.getMessage());
            // 不抛——scheduleNext 失败不影响当前 step 状态（下次 recovery 兜底）
        }
    }

    // ========== buildSubmitRequest（video-job-runner.ts:561-830）==========

    /**
     * 构建视频提交请求（video-job-runner.ts:561-830 buildSubmitRequest 逐字移植）。
     * <p>
     * 校验：prompt/model/duration/dimensions → invalid_input (:598-606)。
     * 参考校验：单数组 references 优先 → 旧字段路径。
     */
    VideoSubmitInput buildSubmitRequest(ClaimedVideoJobDto claim) {
        Map<String, Object> input = claim.input();
        Map<String, Object> params = input.get("parameters") instanceof Map<?, ?> p
                ? castMap(p) : null;

        // prompt（:571-586）
        String basePrompt = strOrEmpty(input, "prompt");
        if (basePrompt.isEmpty()) basePrompt = strOrEmpty(input, "prompt_text");
        // text_attachments 简化处理：Java 侧不实现 composeTextAttachmentPrompt
        // （视频场景 text_attachments 罕见，basePrompt 即最终 prompt）
        String prompt = basePrompt;

        // model（:587-592）
        String model = strOrEmpty(input, "model_id");
        if (model.isEmpty() && params != null) model = strOrEmpty(params, "model_id");

        // duration（:593）
        double duration = resolveDuration(input);

        // dimensions（:594-597）
        int[] dimensions = resolveDimensions(input);

        // 校验（:598-606）
        if (prompt.isEmpty() || model.isEmpty()
                || !Double.isFinite(duration) || duration <= 0 || dimensions == null) {
            log.warn("[IKE7JP] 前置校验遗漏：job {} 视频参数无效仍进入 worker", claim.id());
            throw new VideoInputError(GenerationError.ERROR_INVALID_INPUT, "视频生成参数无效");
        }

        // 参考素材解析（:608-650）
        // 简化路径：直接读 reference_asset_ids / first_frame_asset_id / last_frame_asset_id
        // 单数组 references 路径（:608-649 readReferences）简化处理
        List<?> singleRefsRaw = input.get("references") instanceof List<?> l ? l : null;

        String firstFrameAssetId = readAssetId(input.get("first_frame_asset_id"));
        String lastFrameAssetId = readAssetId(input.get("last_frame_asset_id"));
        List<String> referenceAssetIds = readAssetIds(input.get("reference_asset_ids"));

        if (singleRefsRaw != null) {
            // 单数组路径：按 role 拆帧/参考（:620-649）
            firstFrameAssetId = null;
            lastFrameAssetId = null;
            referenceAssetIds = new ArrayList<>();
            for (Object item : singleRefsRaw) {
                if (!(item instanceof Map<?, ?> ref)) continue;
                Map<?, ?> refMap = ref;
                String role = refMap.get("role") instanceof String s ? s : null;
                String assetId = readAssetId(refMap.get("asset_id"));
                String type = refMap.get("type") instanceof String s ? s : null;

                if ("first_frame".equals(role)) {
                    if (!"image".equals(type)) {
                        throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_TYPE,
                                "首尾帧素材必须是图片");
                    }
                    if (assetId != null) firstFrameAssetId = assetId;
                } else if ("last_frame".equals(role)) {
                    if (!"image".equals(type)) {
                        throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_TYPE,
                                "首尾帧素材必须是图片");
                    }
                    if (assetId != null) lastFrameAssetId = assetId;
                } else {
                    if (assetId != null) referenceAssetIds.add(assetId);
                }
            }
            referenceAssetIds = uniqueStrings(referenceAssetIds);
        }

        // 首尾帧互斥校验（:651-663）
        boolean hasFirstFrame = firstFrameAssetId != null;
        boolean hasLastFrame = lastFrameAssetId != null;
        boolean hasReferences = !referenceAssetIds.isEmpty();

        if (hasLastFrame && !hasFirstFrame) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE,
                    "尾帧必须与首帧一起使用");
        }

        // 旧字段路径互斥校验（:666-671）
        if (singleRefsRaw == null && (hasFirstFrame || hasLastFrame) && hasReferences) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE,
                    "首尾帧模式不能与普通参考素材混用");
        }

        // 解析素材（:672-683）
        List<String> allAssetIds = uniqueStrings(mergeLists(
                firstFrameAssetId != null ? List.of(firstFrameAssetId) : List.of(),
                lastFrameAssetId != null ? List.of(lastFrameAssetId) : List.of(),
                referenceAssetIds));

        Map<String, AssetEntity> assetsMap = allAssetIds.isEmpty()
                ? Map.of()
                : assetSource.resolveInputAssets(allAssetIds, claim.user_id(), claim.project_id());

        if (assetsMap.size() != allAssetIds.size()) {
            throw new VideoInputError(GenerationError.ERROR_REFERENCE_ASSET_UNAVAILABLE,
                    "参考素材不存在或无权访问");
        }

        // 首尾帧类型校验（:756-764）
        AssetEntity firstFrame = firstFrameAssetId != null ? assetsMap.get(firstFrameAssetId) : null;
        AssetEntity lastFrame = lastFrameAssetId != null ? assetsMap.get(lastFrameAssetId) : null;

        if (firstFrame != null && !"image".equals(firstFrame.getType())) {
            throw new VideoInputError(GenerationError.ERROR_UNSUPPORTED_INPUT, "首尾帧素材必须是图片");
        }
        if (lastFrame != null && !"image".equals(lastFrame.getType())) {
            throw new VideoInputError(GenerationError.ERROR_UNSUPPORTED_INPUT, "首尾帧素材必须是图片");
        }

        // 参考素材校验（:765-775 validateReferences）
        List<AssetEntity> referenceAssets = new ArrayList<>();
        for (String id : referenceAssetIds) {
            AssetEntity asset = assetsMap.get(id);
            if (asset == null) {
                throw new VideoInputError(GenerationError.ERROR_REFERENCE_ASSET_UNAVAILABLE,
                        "参考素材不存在或无权访问");
            }
            referenceAssets.add(asset);
        }
        List<VideoReference> references = validateReferences(model, referenceAssets);

        // 构建请求（:819-829）
        String resolution = input.get("resolution") instanceof String s ? s
                : (params != null && params.get("size") instanceof String s ? s : null);
        String ratio = input.get("aspect_ratio") instanceof String s ? s
                : (params != null && params.get("aspect_ratio") instanceof String s ? s : null);

        return new VideoSubmitInput(
                model, prompt, duration, resolution, ratio,
                firstFrame != null ? firstFrame.getUrl() : null,
                lastFrame != null ? lastFrame.getUrl() : null,
                references
        );
    }

    // ========== validateReferences（video-reference-validation.ts:23-95）==========

    /**
     * 参考素材校验（video-reference-validation.ts:23-95 validateReferences 逐字移植）。
     * <p>
     * 图片/视频/音频计数 + 视频物理校验 + Seedance 2.0 约束。
     */
    List<VideoReference> validateReferences(String model, List<AssetEntity> assets) {
        int imageCount = 0;
        int videoCount = 0;
        int audioCount = 0;
        double knownVideoDuration = 0;
        List<VideoReference> references = new ArrayList<>();

        for (AssetEntity asset : assets) {
            if ("image".equals(asset.getType())) {
                imageCount++;
                references.add(new VideoReference("image", asset.getUrl()));
            } else if ("audio".equals(asset.getType())) {
                audioCount++;
                references.add(new VideoReference("audio", asset.getUrl()));
            } else if ("video".equals(asset.getType())) {
                videoCount++;
                validateReferenceVideo(asset);
                if (asset.getDurationMs() != null) {
                    knownVideoDuration += asset.getDurationMs() / 1000.0;
                }
                references.add(new VideoReference("video", asset.getUrl()));
            } else {
                throw new VideoInputError(GenerationError.ERROR_UNSUPPORTED_INPUT,
                        "视频生成只支持图片、视频或音频参考素材");
            }
        }

        // 计数校验（:69-81）
        if (imageCount > MAX_REFERENCE_IMAGES || videoCount > MAX_REFERENCE_VIDEOS) {
            throw new VideoInputError(GenerationError.ERROR_REFERENCE_LIMIT_EXCEEDED,
                    "Seedance 2.0 最多支持 9 张参考图片和 3 个参考视频");
        }
        if (audioCount > MAX_REFERENCE_VIDEOS) {
            throw new VideoInputError(GenerationError.ERROR_REFERENCE_LIMIT_EXCEEDED,
                    "Seedance 2.0 最多支持 3 个参考音频");
        }

        // Seedance 2.0 约束（:82-87）
        if ((videoCount > 0 || audioCount > 0) && !isSeedance2Model(model)) {
            throw new VideoInputError(GenerationError.ERROR_UNSUPPORTED_INPUT,
                    "只有 Seedance 2.0 支持参考视频和参考音频");
        }

        // 视频时长累计校验（:88-93）
        if (knownVideoDuration > MAX_REFERENCE_VIDEO_SECONDS) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_MEDIA,
                    "参考视频已知总时长不能超过 15 秒");
        }

        return references;
    }

    /**
     * 单个参考视频物理校验（video-reference-validation.ts:97-127 validateReferenceVideo）。
     * <p>
     * 边界包含性（与 TS 逐字一致）：
     * size: &gt;200MB 失败 → 200MB 恰好通过
     * duration: &lt;2 或 &gt;15 失败 → 2s/15s 恰好通过
     * side: &lt;300 或 &gt;6000 → 300/6000 恰好通过
     * pixels: &lt;409600 或 &gt;8295044 → 边界恰好通过
     * ratio: &lt;0.4 或 &gt;2.5 → 边界恰好通过
     */
    void validateReferenceVideo(AssetEntity asset) {
        // mime（:98-101）
        if (asset.getMime() != null) {
            String mime = asset.getMime().split(";", 2)[0].trim().toLowerCase();
            if (!REFERENCE_VIDEO_MIMES.contains(mime)) {
                throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_MEDIA,
                        "参考视频只支持 MP4 或 MOV");
            }
        }

        // size（:102-113）：>200MB 失败 → 200MB 恰好通过（`>` 非 `>=`）
        if (asset.getSize() != null
                && (asset.getSize() <= 0 || asset.getSize() > MAX_REFERENCE_VIDEO_BYTES)) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_MEDIA,
                    "单个参考视频不能超过 200 MB");
        }

        // duration（:114-126）：<2 或 >15 失败 → 2s/15s 恰好通过
        if (asset.getDurationMs() != null) {
            double durationSec = asset.getDurationMs() / 1000.0;
            if (durationSec < 2 || durationSec > MAX_REFERENCE_VIDEO_SECONDS) {
                throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_MEDIA,
                        "单个参考视频时长必须为 2 至 15 秒");
            }
        }

        // dimensions（:129-163 validateReferenceVideoDimensions）
        Integer width = asset.getWidth();
        Integer height = asset.getHeight();

        if (width != null && (width < MIN_REFERENCE_VIDEO_SIDE || width > MAX_REFERENCE_VIDEO_SIDE)) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_MEDIA,
                    "参考视频单边像素必须为 300 至 6000");
        }
        if (height != null && (height < MIN_REFERENCE_VIDEO_SIDE || height > MAX_REFERENCE_VIDEO_SIDE)) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_MEDIA,
                    "参考视频单边像素必须为 300 至 6000");
        }

        if (width != null && height != null) {
            long pixels = (long) width * height;
            double ratio = (double) width / height;
            if (pixels < MIN_REFERENCE_VIDEO_PIXELS || pixels > MAX_REFERENCE_VIDEO_PIXELS
                    || ratio < MIN_REFERENCE_VIDEO_RATIO || ratio > MAX_REFERENCE_VIDEO_RATIO) {
                throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_MEDIA,
                        "参考视频宽高比或总像素不满足 Seedance 2.0 要求");
            }
        }
    }

    // ========== isTransientPollError（video-job-runner.ts:392-413）==========

    /**
     * 瞬时轮询错误判定（video-job-runner.ts:392-413 isTransientPollError 逐字移植）。
     * <p>
     * 网络不可达 / 超时 → 瞬时。
     * HTTP 429/500/502/503/504 → 瞬时（但 invalid_json_response / invalid_video_response 除外）。
     * 4xx 与业务失败 → 非瞬时。
     */
    static boolean isTransientPollError(VideoProviderError error) {
        String code = error.getCode();

        // provider_timeout → 网络超时（video-job-runner.ts:393 NewApiTimeoutError 等价）
        if (GenerationError.ERROR_PROVIDER_TIMEOUT.equals(code)) return true;

        // provider_failed + cause 是网络/超时异常 → 瞬时
        if (GenerationError.ERROR_PROVIDER_FAILED.equals(code)) {
            Throwable cause = error.getCause();
            if (cause instanceof java.net.ConnectException
                    || cause instanceof java.net.UnknownHostException) {
                return true; // NewApiNetworkError 等价
            }
            // HTTP 5xx 白名单通过 HttpStatusException
            if (cause instanceof NewApiVideoClient.HttpStatusException hse) {
                int status = hse.getStatus();
                if (status == 429 || status == 500 || status == 502
                        || status == 503 || status == 504) {
                    // invalid_json_response / invalid_video_response 排除（:405-408）
                    return !("invalid_json_response".equals(code)
                            || "invalid_video_response".equals(code));
                }
            }
        }

        // invalid_json_response / invalid_video_response 在 502 内 → 非瞬时
        if ("invalid_json_response".equals(code) || "invalid_video_response".equals(code)) {
            return false;
        }

        return false;
    }

    // ========== videoDimensions / dimensionsFromSize（video-dimensions.ts）==========

    /**
     * 视频尺寸换算（video-dimensions.ts:3-25 逐字移植）。
     * <p>
     * resolution + aspect_ratio → width/height；或 size "WxH" → width/height。
     */
    static int[] resolveDimensions(Map<String, Object> input) {
        Map<String, Object> params = input.get("parameters") instanceof Map<?, ?> p
                ? castMap(p) : null;

        // videoDimensions（:3-13）
        Object resolutionObj = input.get("resolution");
        Object aspectRatioObj = input.get("aspect_ratio");
        if (resolutionObj instanceof String resolution && aspectRatioObj instanceof String aspectRatio) {
            int[] dims = videoDimensions(resolution, aspectRatio);
            if (dims != null) return dims;
        }

        // dimensionsFromSize（:16-25）
        Object sizeObj = params != null ? params.get("size") : input.get("size");
        if (sizeObj instanceof String size) {
            return dimensionsFromSize(size);
        }
        return null;
    }

    static int[] videoDimensions(String resolution, String aspectRatio) {
        Matcher resMatcher = RESOLUTION_PATTERN.matcher(resolution);
        if (!resMatcher.matches()) return null;
        Matcher ratioMatcher = RATIO_PATTERN.matcher(aspectRatio);
        if (!ratioMatcher.matches()) return null;

        int height = Integer.parseInt(resMatcher.group(1));
        if (height <= 0) return null;

        int rw = Integer.parseInt(ratioMatcher.group(1));
        int rh = Integer.parseInt(ratioMatcher.group(2));
        int width = (int) (Math.round((double) height * rw / rh / 2) * 2);
        return new int[]{width, height};
    }

    static int[] dimensionsFromSize(String size) {
        Matcher m = SIZE_PATTERN.matcher(size);
        if (!m.matches()) return null;
        int width = Integer.parseInt(m.group(1));
        int height = Integer.parseInt(m.group(2));
        if (width <= 0 || height <= 0) return null;
        return new int[]{width, height};
    }

    // ========== 工具方法 ==========

    static double resolveDuration(Map<String, Object> input) {
        Map<String, Object> params = input.get("parameters") instanceof Map<?, ?> p
                ? castMap(p) : null;
        Object dObj = input.get("duration");
        if (dObj == null && params != null) dObj = params.get("duration");
        if (dObj instanceof Number n) return n.doubleValue();
        if (dObj instanceof String s) {
            try { return Double.parseDouble(s); } catch (NumberFormatException e) { return 0; }
        }
        return 0;
    }

    static boolean isSeedance2Model(String model) {
        return model != null && SEEDANCE2_PATTERN.matcher(model).find();
    }

    private static String readAssetId(Object value) {
        return (value instanceof String s && !s.isEmpty()) ? s : null;
    }

    @SuppressWarnings("unchecked")
    private static List<String> readAssetIds(Object value) {
        if (!(value instanceof List<?> list)) return new ArrayList<>();
        List<String> result = new ArrayList<>();
        for (Object item : list) {
            if (item instanceof String s && !s.isEmpty()) result.add(s);
        }
        return result;
    }

    private static List<String> uniqueStrings(List<String> input) {
        LinkedHashSet<String> set = new LinkedHashSet<>(input);
        return new ArrayList<>(set);
    }

    private static List<String> mergeLists(List<String>... lists) {
        List<String> result = new ArrayList<>();
        for (List<String> list : lists) result.addAll(list);
        return result;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Map<?, ?> map) {
        return (Map<String, Object>) map;
    }

    private static String strOrEmpty(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return (v instanceof String s) ? s : "";
    }

    private static String hostname() {
        try {
            return java.net.InetAddress.getLocalHost().getHostName();
        } catch (Exception e) {
            return "unknown";
        }
    }
}
