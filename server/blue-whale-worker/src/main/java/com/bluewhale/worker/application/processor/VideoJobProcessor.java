package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedVideoJobDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.GenerationErrorDetailContract;
import com.bluewhale.worker.domain.contract.GenerationMqRouteEnum;
import com.bluewhale.worker.domain.contract.VideoSampleContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoInputError;
import com.bluewhale.worker.domain.error.VideoProviderError;
import com.bluewhale.common.http.NewApiHttpSupport;
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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
public class VideoJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(VideoJobProcessor.class);

    public static final long VIDEO_POLL_INTERVAL_MS = 5_000;

    public static final int MAX_VIDEO_POLLS = 720;

    public static final String ERROR_DETAIL_SUBMIT_TIMEOUT_ORPHAN = "submit_timeout_orphan";


    static final long DEFAULT_MAX_REFERENCE_VIDEO_BYTES = 200L * 1024 * 1024;
    static final int DEFAULT_MIN_REFERENCE_VIDEO_SECONDS = 2;
    static final int DEFAULT_MIN_REFERENCE_VIDEO_SIDE = 300;
    static final int DEFAULT_MAX_REFERENCE_VIDEO_SIDE = 6000;
    static final int DEFAULT_MIN_REFERENCE_VIDEO_PIXELS = 409_600;
    static final int DEFAULT_MAX_REFERENCE_VIDEO_PIXELS = 8_295_044;
    static final double DEFAULT_MIN_REFERENCE_VIDEO_RATIO = 0.4;
    static final double DEFAULT_MAX_REFERENCE_VIDEO_RATIO = 2.5;
    static final Set<String> DEFAULT_REFERENCE_VIDEO_MIMES = Set.of("video/mp4", "video/quicktime");

    static final int LEGACY_MAX_REFERENCE_IMAGES = 9;
    static final int LEGACY_MAX_REFERENCE_VIDEOS = 3;
    static final int LEGACY_MAX_REFERENCE_VIDEO_SECONDS = 15;

    record ReferenceLimits(int maxImages, int maxVideos, int maxAudios, Integer maxDurationSec) {}

    static final ReferenceLimits LEGACY_REFERENCE_LIMITS = new ReferenceLimits(
            LEGACY_MAX_REFERENCE_IMAGES, LEGACY_MAX_REFERENCE_VIDEOS,
            LEGACY_MAX_REFERENCE_VIDEOS, LEGACY_MAX_REFERENCE_VIDEO_SECONDS);

    static ReferenceLimits referenceLimitsOf(Map<String, Object> input) {
        if (!(input.get("reference_limits") instanceof Map<?, ?> raw)) {
            return LEGACY_REFERENCE_LIMITS;
        }
        Map<String, Object> limits = castMap(raw);
        Integer maxDurationSec = LEGACY_MAX_REFERENCE_VIDEO_SECONDS;
        if (limits.containsKey("max_reference_duration_sec")) {
            maxDurationSec = positiveIntOrNull(limits.get("max_reference_duration_sec"));
        }
        return new ReferenceLimits(
                intOr(limits.get("image_reference_max"), LEGACY_MAX_REFERENCE_IMAGES),
                intOr(limits.get("video_reference_max"), LEGACY_MAX_REFERENCE_VIDEOS),
                intOr(limits.get("audio_reference_max"), LEGACY_MAX_REFERENCE_VIDEOS),
                maxDurationSec);
    }

    private static int intOr(Object value, int fallback) {
        return value instanceof Number n && n.intValue() >= 0 ? n.intValue() : fallback;
    }

    private static Integer positiveIntOrNull(Object value) {
        return value instanceof Number n && n.intValue() > 0 ? n.intValue() : null;
    }

    static final Pattern MATERIAL_ID_PATTERN = Pattern.compile("^[Aa]sset-.{1,128}$");

    record MaterialRef(String id, String type) {}

    record SingleRef(String role, String type, String assetId, String materialId) {}

    private static final Pattern RESOLUTION_PATTERN = Pattern.compile("^([0-9]+)p$");
    private static final Pattern RATIO_PATTERN = Pattern.compile("^([1-9][0-9]*):([1-9][0-9]*)$");
    private static final Pattern SIZE_PATTERN = Pattern.compile("^([0-9]+)x([0-9]+)$", Pattern.CASE_INSENSITIVE);

    private final JobStateMachineService stateMachine;
    private final JobFinalizer finalizer;
    private final AssetSourceService assetSource;
    private final UpstreamCredential upstreamCredential;
    private final NewApiVideoClient videoClient;
    private final TosVideoMediaRelay mediaRelay;
    private final GenerationMessageProducer producer;
    private final String workerId;

    @org.springframework.beans.factory.annotation.Autowired
    public VideoJobProcessor(
            JobStateMachineService stateMachine,
            JobFinalizer finalizer,
            AssetSourceService assetSource,
            UpstreamCredential upstreamCredential,
            NewApiVideoClient videoClient,
            TosVideoMediaRelay mediaRelay,
            @org.springframework.beans.factory.annotation.Qualifier("generationMessageProducer")
            GenerationMessageProducer producer
    ) {
        this(stateMachine, finalizer, assetSource, upstreamCredential, videoClient, mediaRelay, producer,
                "video-" + hostname() + "-" + ProcessHandle.current().pid());
    }

    VideoJobProcessor(
            JobStateMachineService stateMachine,
            JobFinalizer finalizer,
            AssetSourceService assetSource,
            UpstreamCredential upstreamCredential,
            NewApiVideoClient videoClient,
            TosVideoMediaRelay mediaRelay,
            GenerationMessageProducer producer,
            String workerId
    ) {
        this.stateMachine = stateMachine;
        this.finalizer = finalizer;
        this.assetSource = assetSource;
        this.upstreamCredential = upstreamCredential;
        this.videoClient = videoClient;
        this.mediaRelay = mediaRelay;
        this.producer = producer;
        this.workerId = workerId;
    }

    @Override
    public String tag() {
        return GenerationMqRouteEnum.VIDEO.tag();
    }

    @Override
    public void handle(String jobId) {
        Optional<ClaimedVideoJobDto> claimOpt;
        try {
            claimOpt = stateMachine.claimVideoJobById(jobId, workerId);
        } catch (Exception error) {
            log.error("[video] claimVideoJobById 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error;
        }
        if (claimOpt.isEmpty()) return;

        ClaimedVideoJobDto claim = claimOpt.get();
        log.info("[video] 已领取 jobId={} token={} providerTaskId={} pollCount={}",
                claim.id(), claim.fencingToken(), claim.providerTaskId(), claim.pollCount());

        if (claim.cancelRequested() && claim.providerTaskId() == null) {
            log.info("[video] 取消已执行(cancelBeforeDispatch) jobId={}", claim.id());
            stateMachine.cancelVideoBeforeDispatch(claim.id(), claim.workerId(), claim.fencingToken());
            return;
        }

        String providerToken;
        try {
            providerToken = upstreamCredential.requireKey();
        } catch (IllegalStateException e) {
            log.warn("[video] 生成服务凭证未配置 jobId={}: {}", claim.id(), e.getMessage());
            failVideo(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING, "生成服务凭证未配置");
            return;
        }

        try {
            runVideoStep(claim, providerToken);
        } catch (Exception error) {
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
            Integer httpStatus = NewApiHttpSupport.upstreamHttpStatus(error);
            if (httpStatus != null) {
                message = message.replaceAll(": HTTP " + httpStatus + "\\b", ":");
            }
            boolean submitTimeoutOrphan = claim.providerTaskId() == null
                    && hasSocketTimeoutCause(error);
            if (submitTimeoutOrphan) {
                log.error("[video] 提交超时疑似孤儿任务 jobId={}：上游可能已建单扣量但拿不到 "
                        + "provider_task_id，本 job 落显式失败终态待对账（IKJ80P）", claim.id());
            }
            log.error("runVideoJobStep 异常 jobId={} code={}: {}", claim.id(), code, message, error);
            failVideo(claim, code, message, httpStatus, submitTimeoutOrphan);
        }
    }

    private void runVideoStep(ClaimedVideoJobDto claim, String providerToken) {
        if (claim.providerTaskId() == null) {

            if (claim.parentProviderTaskId() != null) {
                boolean settled = tryReuseParentResult(claim, providerToken);
                if (settled) return;
            }

            if ("final".equals(claim.videoStage())) {
                submitFinalize(claim, providerToken);
                return;
            }

            VideoSubmitInput request = buildSubmitRequest(claim);

            dispatchSubmission(claim, () -> videoClient.submit(providerToken, request));
        } else {
            pollPhase(claim, providerToken);
        }
    }

    private void dispatchSubmission(ClaimedVideoJobDto claim,
                                    java.util.function.Supplier<SubmitResult> call) {
        if (!stateMachine.markSubmissionAttempt(claim.id(), claim.workerId(), claim.fencingToken())) {
            return;
        }
        SubmitResult submitted;
        try {
            submitted = call.get();
        } catch (VideoProviderError error) {
            if (NewApiHttpSupport.upstreamHttpStatus(error) != null) {
                throw error;
            }
            recordSubmissionUnknown(claim, error);
            return;
        } catch (Exception error) {
            recordSubmissionUnknown(claim, error);
            return;
        }
        boolean updated;
        try {
            updated = stateMachine.markProviderSubmitted(
                    claim.id(), claim.workerId(), claim.fencingToken(), submitted.taskId());
        } catch (Exception error) {
            recordSubmissionUnknown(claim, error);
            return;
        }
        if (updated) {
            scheduleNext(claim.id(), VIDEO_POLL_INTERVAL_MS);
        }
    }

    private void recordSubmissionUnknown(ClaimedVideoJobDto claim, Exception error) {
        String message = error.getMessage() != null ? error.getMessage()
                : error.getClass().getSimpleName();
        log.error("[video] 提交结果不明，任务留在 checking 锁定（不重提不退款，交人工核对）jobId={} err={}",
                claim.id(), message, error);
        try {
            String code = error instanceof VideoProviderError vpe ? vpe.getCode()
                    : error.getClass().getSimpleName();
            stateMachine.appendLog(claim.id(), "submission_unknown", "checking",
                    "提交结果不明，任务锁定待核对: " + message, Map.of("code", code));
        } catch (Exception logError) {
            log.warn("[video] submission_unknown 日志落库失败（任务仍锁定）jobId={}: {}",
                    claim.id(), logError.getMessage());
        }
    }

    private void submitFinalize(ClaimedVideoJobDto claim, String providerToken) {
        String sampleTaskId = claim.sourceSampleProviderTaskId();
        if (sampleTaskId == null || sampleTaskId.isEmpty()) {
            log.error("[video] 成片缺少来源样片上游任务 ID，按本阶段失败处理 jobId={}", claim.id());
            failVideo(claim, GenerationError.ERROR_INVALID_INPUT, "成片缺少来源样片的上游任务 ID");
            return;
        }
        dispatchSubmission(claim, () -> videoClient.finalize(providerToken, sampleTaskId));
    }

    private void pollPhase(ClaimedVideoJobDto claim, String providerToken) {
        VideoTaskObservation observation;
        try {
            observation = videoClient.poll(providerToken, claim.providerTaskId());
        } catch (VideoProviderError pollError) {
            if (isTransientPollError(pollError)) {
                if (claim.pollCount() >= MAX_VIDEO_POLLS) {
                    log.warn("[video] 轮询瞬时错误且已达轮询上限 jobId={} pollCount={} err={}，归失败终态",
                            claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                    Integer httpStatus = NewApiHttpSupport.upstreamHttpStatus(pollError);
                    String message = "视频生成轮询超时（超过 " + MAX_VIDEO_POLLS + " 次），上游持续错误: "
                            + pollError.getMessage();
                    if (httpStatus != null) {
                        message = message.replaceAll(": HTTP " + httpStatus + "\\b", ":");
                    }
                    failVideo(claim, GenerationError.ERROR_PROVIDER_TIMEOUT, message, httpStatus);
                    return;
                }
                log.warn("[video] 轮询瞬时错误 jobId={} pollCount={} err={}，重排继续轮询（IKEA26）",
                        claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                boolean updated = stateMachine.rescheduleProviderPoll(
                        claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
                if (updated) {
                    log.info("[video] 瞬时重试已排队 jobId={} pollCount={} nextDelayMs={}",
                            claim.id(), claim.pollCount(), VIDEO_POLL_INTERVAL_MS);
                    scheduleNext(claim.id(), VIDEO_POLL_INTERVAL_MS);
                }
                return;
            }
            throw pollError;
        }

        if ("queued".equals(observation.status()) || "processing".equals(observation.status())) {
            log.debug("video job 轮询中 jobId={} status={} progress={}",
                    claim.id(), observation.status(), observation.progress());

            if (claim.pollCount() >= MAX_VIDEO_POLLS) {
                failVideo(claim, GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "视频生成轮询超时（超过 " + MAX_VIDEO_POLLS + " 次）");
                return;
            }

            boolean updated = stateMachine.rescheduleProviderPoll(
                    claim.id(), claim.workerId(), claim.fencingToken(), observation.progress());
            if (updated) {
                scheduleNext(claim.id(), VIDEO_POLL_INTERVAL_MS);
            }
            return;
        }

        if ("failed".equals(observation.status())) {
            String code = observation.error() != null && observation.error().code() != null
                    ? observation.error().code() : GenerationError.ERROR_PROVIDER_FAILED;
            String message = observation.error() != null && observation.error().message() != null
                    ? observation.error().message() : "视频生成失败";
            log.info("[video] 上游状态终态=failed jobId={} providerTaskId={} code={} pollCount={}",
                    claim.id(), claim.providerTaskId(), code, claim.pollCount());
            failVideo(claim, code, message);
            return;
        }

        log.info("[video] 上游状态终态=succeeded jobId={} providerTaskId={} pollCount={}",
                claim.id(), claim.providerTaskId(), claim.pollCount());
        if (observation.url() == null || observation.url().isEmpty()) {
            failVideo(claim, GenerationError.ERROR_PROVIDER_FAILED, "视频任务成功但未返回 URL");
            return;
        }

        publishVideo(claim, observation);
    }

    private boolean tryReuseParentResult(ClaimedVideoJobDto claim, String providerToken) {
        VideoTaskObservation observation;
        try {
            observation = videoClient.poll(providerToken, claim.parentProviderTaskId());
        } catch (Exception error) {
            log.warn("[video] 重试查上游失败 jobId={} parentTask={} err={}，按不存在处理重新 submit（IKEA26）",
                    claim.id(), claim.parentProviderTaskId(), error.getMessage(), error);
            return false;
        }

        if (!"succeeded".equals(observation.status())
                || observation.url() == null || observation.url().isBlank()) {
            log.info("[video] 重试收割未命中(旧结果不可用) jobId={} parentTask={} status={}，回退重新提交",
                    claim.id(), claim.parentProviderTaskId(), observation.status());
            return false;
        }

        boolean published;
        try {
            published = publishVideo(claim, observation);
        } catch (Exception error) {
            log.warn("[video] 重试收割发布异常(旧结果不可用) jobId={} parentTask={} err={}，回退重新提交",
                    claim.id(), claim.parentProviderTaskId(), error.getMessage(), error);
            return false;
        }
        if (!published) {
            log.warn("[video] 重试收割失去执行权 jobId={} parentTask={}（发布守卫未命中：stale/租约失效/已终态），停止不再重新提交（IKICD3）",
                    claim.id(), claim.parentProviderTaskId());
        }
        return true;
    }

    private boolean publishVideo(ClaimedVideoJobDto claim, VideoTaskObservation observation) {
        boolean sample = Boolean.TRUE.equals(
                claim.input().get(VideoSampleContract.INPUT_SAMPLE_MODE));
        boolean twoPhase = sample || "final".equals(claim.videoStage());
        StoredVideo stored;
        if (mediaRelay != null) {
            stored = mediaRelay.persist(observation.url(), claim.user_id());
        } else if (twoPhase) {
            log.error("[video] 两阶段结果转存不可用（TOS 未配置），按本阶段失败处理（不保存供应商 URL）jobId={}",
                    claim.id());
            failVideo(claim, GenerationError.ERROR_PROVIDER_FAILED, "视频结果转存不可用，已按失败处理");
            return false;
        } else {
            log.warn("[video] TOS 未配置，降级直存供应商 URL：assets.md5 将为空（IKGS73 已知边界）");
            stored = new StoredVideo(observation.url(), null, null, null, null);
        }
        log.info("[video] 转存完成 jobId={} storageKey={} size={}", claim.id(), stored.storageKey(), stored.size());

        int[] dimensions = resolveDimensions(claim.input());
        Integer width = dimensions != null ? dimensions[0] : null;
        Integer height = dimensions != null ? dimensions[1] : null;

        double duration = resolveDuration(claim.input());

        Long upstreamCreatedAtMs = sample ? observation.upstreamCreatedAtMs() : null;
        Long finalizeDeadlineMs = sample && upstreamCreatedAtMs != null
                ? VideoSampleContract.finalizeDeadlineMs(upstreamCreatedAtMs) : null;

        boolean published = finalizer.publishVideoResult(
                claim.id(), claim.project_id(), claim.user_id(),
                claim.workerId(), claim.fencingToken(),
                stored.url(), stored.storageKey(), stored.mime(), stored.size(), stored.md5(),
                width, height, duration,
                upstreamCreatedAtMs, finalizeDeadlineMs);
        if (published) {
            log.info("[video] 发布成功 jobId={} 上游token={} 样片截止={}", claim.id(),
                    observation.totalTokens() != null ? observation.totalTokens() : "未上报",
                    finalizeDeadlineMs != null ? finalizeDeadlineMs : "缺可信created_at(禁成片)");
        } else {
            log.warn("[video] 终态失败(publishVideoResult 守卫未命中) jobId={}", claim.id());
        }
        return published;
    }

    private void failVideo(ClaimedVideoJobDto claim, String code, String message) {
        failVideo(claim, code, message, null);
    }

    private void failVideo(ClaimedVideoJobDto claim, String code, String message, Integer httpStatus) {
        failVideo(claim, code, message, httpStatus, false);
    }

    private void failVideo(ClaimedVideoJobDto claim, String code, String message, Integer httpStatus,
                           boolean submitTimeoutOrphan) {
        log.warn("video job 失败 jobId={} code={} message={}", claim.id(), code, message);
        Map<String, Object> details = new HashMap<>();
        details.put("raw", message);
        if (httpStatus != null) {
            details.put(GenerationErrorDetailContract.ERROR_DETAIL_HTTP_STATUS, httpStatus);
        }
        if (submitTimeoutOrphan) {
            details.put(ERROR_DETAIL_SUBMIT_TIMEOUT_ORPHAN, true);
        }
        finalizer.failVideoJob(claim.id(), code, message, details, claim.workerId(), claim.fencingToken());
    }

    private void scheduleNext(String jobId, long delayMs) {
        try {
            producer.enqueue(jobId, delayMs);
        } catch (Exception e) {
            log.error("[video] scheduleNext MQ 发送失败 jobId={} delayMs={}: {}", jobId, delayMs, e.getMessage(), e);
            throw e;
        }
    }


    VideoSubmitInput buildSubmitRequest(ClaimedVideoJobDto claim) {
        Map<String, Object> input = claim.input();
        Map<String, Object> params = input.get("parameters") instanceof Map<?, ?> p
                ? castMap(p) : null;
        boolean sample = Boolean.TRUE.equals(input.get(VideoSampleContract.INPUT_SAMPLE_MODE));

        String basePrompt = strOrEmpty(input, "prompt");
        if (basePrompt.isEmpty()) basePrompt = strOrEmpty(input, "prompt_text");
        Map<?, ?> plan = input.get("prompt_plan_snapshot") instanceof Map<?, ?> snapshot ? snapshot : null;
        if (input.containsKey("prompt_plan_snapshot") && (plan == null || !(plan.get("videoReferences") instanceof List<?>))) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_INPUT, "视频方案快照无效");
        }
        String prompt = basePrompt;

        String model = strOrEmpty(input, "model_id");
        if (model.isEmpty() && params != null) model = strOrEmpty(params, "model_id");

        double duration = resolveDuration(input);

        Boolean generateAudio = input.get("generate_audio") instanceof Boolean b ? b : null;

        String frozenMode = input.get("video_mode") instanceof String s ? s
                : input.get("video_task_type") instanceof String t ? t : null;
        String videoTaskType = "default".equals(frozenMode) ? "text2video"
                : "prolong".equals(frozenMode) ? "extend" : frozenMode;
        boolean omniTaskTypeAllowed =
                input.get("omni_reference_task_type_allowed") instanceof Boolean b && b;

        boolean autoDurationAllowed = "edit".equals(videoTaskType) || "extend".equals(videoTaskType);
        boolean durationOk = Double.isFinite(duration)
                && (duration > 0 || (duration == -1 && autoDurationAllowed));
        if (prompt.isEmpty() || model.isEmpty() || !durationOk) {
            log.warn("[IKE7JP] 前置校验遗漏：job {} 视频参数无效仍进入 worker（taskType={} duration={}）",
                    claim.id(), videoTaskType, duration);
            throw new VideoInputError(GenerationError.ERROR_INVALID_INPUT, "视频生成参数无效");
        }

        if (plan != null) {
            List<VideoReference> references = new ArrayList<>();
            String first = null;
            String last = null;
            for (Object raw : (List<?>) plan.get("videoReferences")) {
                if (!(raw instanceof Map<?, ?> ref) || !(ref.get("type") instanceof String type)
                        || !List.of("image", "video", "audio").contains(type)
                        || !(ref.get("providerUrl") instanceof String url) || url.isBlank()
                        || !(ref.get("role") instanceof String role) || !List.of("reference", "first_frame", "last_frame").contains(role)) {
                    throw new VideoInputError(GenerationError.ERROR_INVALID_INPUT, "视频素材快照无效");
                }
                if ("first_frame".equals(role)) first = url;
                else if ("last_frame".equals(role)) last = url;
                else references.add(new VideoReference(type, url));
            }
            return new VideoSubmitInput(model, prompt, duration,
                    strOrEmpty(input, "resolution"), strOrEmpty(input, "aspect_ratio"), first, last, references,
                    generateAudio, sample, videoTaskType, omniTaskTypeAllowed);
        }

        List<SingleRef> singleRefsRaw = readReferences(input.get("references"));

        String firstFrameAssetId = readAssetId(input.get("first_frame_asset_id"));
        String lastFrameAssetId = readAssetId(input.get("last_frame_asset_id"));
        List<String> referenceAssetIds = uniqueStrings(readAssetIds(input.get("reference_asset_ids")));
        String firstFrameMaterialId = null;
        String lastFrameMaterialId = null;
        List<MaterialRef> referenceMaterials = new ArrayList<>();

        if (singleRefsRaw != null) {
            firstFrameAssetId = null;
            lastFrameAssetId = null;
            referenceAssetIds = new ArrayList<>();
            firstFrameMaterialId = null;
            lastFrameMaterialId = null;
            referenceMaterials = new ArrayList<>();
            for (SingleRef ref : singleRefsRaw) {
                boolean isFirstFrame = "first_frame".equals(ref.role());
                boolean isLastFrame = "last_frame".equals(ref.role());

                if ((isFirstFrame || isLastFrame) && !"image".equals(ref.type())) {
                    throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_TYPE,
                            "首尾帧素材必须是图片");
                }

                if (ref.assetId() != null) {
                    if (isFirstFrame) firstFrameAssetId = ref.assetId();
                    else if (isLastFrame) lastFrameAssetId = ref.assetId();
                    else referenceAssetIds.add(ref.assetId());
                } else if (isFirstFrame) {
                    firstFrameMaterialId = ref.materialId();
                } else if (isLastFrame) {
                    lastFrameMaterialId = ref.materialId();
                } else {
                    referenceMaterials.add(new MaterialRef(ref.materialId(), ref.type()));
                }
            }
            referenceAssetIds = uniqueStrings(referenceAssetIds);
        }

        if (firstFrameAssetId != null && firstFrameMaterialId != null) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE, "首帧只能指定一个来源");
        }
        if (lastFrameAssetId != null && lastFrameMaterialId != null) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE, "尾帧只能指定一个来源");
        }

        boolean hasFirstFrame = firstFrameAssetId != null || firstFrameMaterialId != null;
        boolean hasLastFrame = lastFrameAssetId != null || lastFrameMaterialId != null;
        boolean hasReferences = !referenceAssetIds.isEmpty() || !referenceMaterials.isEmpty();

        if (hasLastFrame && !hasFirstFrame) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE,
                    "尾帧必须与首帧一起使用");
        }

        if (singleRefsRaw == null && (hasFirstFrame || hasLastFrame) && hasReferences) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE,
                    "首尾帧模式不能与普通参考素材混用");
        }

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

        AssetEntity firstFrame = firstFrameAssetId != null ? assetsMap.get(firstFrameAssetId) : null;
        AssetEntity lastFrame = lastFrameAssetId != null ? assetsMap.get(lastFrameAssetId) : null;

        if (firstFrame != null && !"image".equals(firstFrame.getType())) {
            throw new VideoInputError(GenerationError.ERROR_UNSUPPORTED_INPUT, "首尾帧素材必须是图片");
        }
        if (lastFrame != null && !"image".equals(lastFrame.getType())) {
            throw new VideoInputError(GenerationError.ERROR_UNSUPPORTED_INPUT, "首尾帧素材必须是图片");
        }

        String firstFrameMaterialResolved = firstFrameMaterialId != null
                ? firstFrameMaterialId : linkedMaterialId(firstFrame);
        String lastFrameMaterialResolved = lastFrameMaterialId != null
                ? lastFrameMaterialId : linkedMaterialId(lastFrame);

        List<MaterialRef> materialRefsFromAssets = new ArrayList<>();
        List<String> unlinkedReferenceAssetIds = new ArrayList<>();
        for (String id : referenceAssetIds) {
            AssetEntity asset = assetsMap.get(id);
            String linked = linkedMaterialId(asset);
            if (linked != null) {
                materialRefsFromAssets.add(new MaterialRef(linked, materialTypeOf(asset)));
            } else {
                unlinkedReferenceAssetIds.add(id);
            }
        }

        List<MaterialRef> allMaterials = new ArrayList<>(referenceMaterials);
        allMaterials.addAll(materialRefsFromAssets);
        List<MaterialRef> mergedMaterials = uniqueMaterialRefs(allMaterials);

        List<AssetEntity> referenceAssets = new ArrayList<>();
        for (String id : unlinkedReferenceAssetIds) {
            AssetEntity asset = assetsMap.get(id);
            if (asset == null) {
                throw new VideoInputError(GenerationError.ERROR_REFERENCE_ASSET_UNAVAILABLE,
                        "参考素材不存在或无权访问");
            }
            referenceAssets.add(asset);
        }
        List<VideoReference> references = validateReferences(
                referenceLimitsOf(input), referenceAssets, mergedMaterials);

        String resolution = input.get("resolution") instanceof String s ? s
                : (params != null && params.get("size") instanceof String s ? s : null);
        String ratio = input.get("aspect_ratio") instanceof String s ? s
                : (params != null && params.get("aspect_ratio") instanceof String s ? s : null);

        String firstFrameImage = firstFrameMaterialResolved != null
                ? "asset://" + firstFrameMaterialResolved
                : (firstFrame != null ? firstFrame.getUrl() : null);
        String lastFrameImage = lastFrameMaterialResolved != null
                ? "asset://" + lastFrameMaterialResolved
                : (lastFrame != null ? lastFrame.getUrl() : null);

        if (singleRefsRaw != null) {
            List<VideoReference> merged = new ArrayList<>();
            if (firstFrameImage != null) {
                merged.add(new VideoReference("image", firstFrameImage, "first_frame"));
            }
            if (lastFrameImage != null) {
                merged.add(new VideoReference("image", lastFrameImage, "last_frame"));
            }
            merged.addAll(references);
            return new VideoSubmitInput(model, prompt, duration, resolution, ratio,
                    null, null, merged, generateAudio, sample, videoTaskType, omniTaskTypeAllowed);
        }

        return new VideoSubmitInput(
                model, prompt, duration, resolution, ratio,
                firstFrameImage, lastFrameImage, references, generateAudio, sample, videoTaskType,
                omniTaskTypeAllowed
        );
    }


    List<VideoReference> validateReferences(ReferenceLimits limits, List<AssetEntity> assets,
                                            List<MaterialRef> materials) {
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
                validateReferenceVideo(asset, limits.maxDurationSec());
                if (asset.getDurationMs() != null) {
                    knownVideoDuration += asset.getDurationMs() / 1000.0;
                }
                references.add(new VideoReference("video", asset.getUrl()));
            } else {
                throw new VideoInputError(GenerationError.ERROR_UNSUPPORTED_INPUT,
                        "视频生成只支持图片、视频或音频参考素材");
            }
        }

        for (MaterialRef material : materials) {
            if ("image".equals(material.type())) {
                imageCount++;
            } else if ("video".equals(material.type())) {
                videoCount++;
            } else {
                audioCount++;
            }
            references.add(new VideoReference(material.type(), "asset://" + material.id()));
        }

        if (imageCount > limits.maxImages()) {
            throw new VideoInputError(GenerationError.ERROR_REFERENCE_LIMIT_EXCEEDED,
                    "参考图最多 " + limits.maxImages() + " 张");
        }
        if (videoCount > limits.maxVideos()) {
            throw new VideoInputError(GenerationError.ERROR_REFERENCE_LIMIT_EXCEEDED,
                    "参考视频最多 " + limits.maxVideos() + " 个");
        }
        if (audioCount > limits.maxAudios()) {
            throw new VideoInputError(GenerationError.ERROR_REFERENCE_LIMIT_EXCEEDED,
                    "参考音频最多 " + limits.maxAudios() + " 个");
        }


        if (limits.maxDurationSec() != null && knownVideoDuration > limits.maxDurationSec()) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_MEDIA,
                    "参考视频已知总时长不能超过 " + limits.maxDurationSec() + " 秒");
        }

        return references;
    }

    List<VideoReference> validateReferences(ReferenceLimits limits, List<AssetEntity> assets) {
        return validateReferences(limits, assets, List.of());
    }

    void validateReferenceVideo(AssetEntity asset, Integer maxDurationSec) {
        if (asset.getMime() != null) {
            String mime = asset.getMime().split(";", 2)[0].trim().toLowerCase();
            if (!DEFAULT_REFERENCE_VIDEO_MIMES.contains(mime)) {
                throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_MEDIA,
                        "参考视频只支持 MP4 或 MOV");
            }
        }

        if (asset.getSize() != null
                && (asset.getSize() <= 0 || asset.getSize() > DEFAULT_MAX_REFERENCE_VIDEO_BYTES)) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_MEDIA,
                    "单个参考视频不能超过 200 MB");
        }

        if (asset.getDurationMs() != null) {
            double durationSec = asset.getDurationMs() / 1000.0;
            if (durationSec < DEFAULT_MIN_REFERENCE_VIDEO_SECONDS
                    || (maxDurationSec != null && durationSec > maxDurationSec)) {
                throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_MEDIA,
                        maxDurationSec == null
                                ? "单个参考视频时长不能少于 " + DEFAULT_MIN_REFERENCE_VIDEO_SECONDS + " 秒"
                                : "单个参考视频时长必须为 " + DEFAULT_MIN_REFERENCE_VIDEO_SECONDS
                                        + " 至 " + maxDurationSec + " 秒");
            }
        }

        Integer width = asset.getWidth();
        Integer height = asset.getHeight();

        if (width != null && (width < DEFAULT_MIN_REFERENCE_VIDEO_SIDE || width > DEFAULT_MAX_REFERENCE_VIDEO_SIDE)) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_MEDIA,
                    "参考视频单边像素必须为 300 至 6000");
        }
        if (height != null && (height < DEFAULT_MIN_REFERENCE_VIDEO_SIDE || height > DEFAULT_MAX_REFERENCE_VIDEO_SIDE)) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_MEDIA,
                    "参考视频单边像素必须为 300 至 6000");
        }

        if (width != null && height != null) {
            long pixels = (long) width * height;
            double ratio = (double) width / height;
            if (pixels < DEFAULT_MIN_REFERENCE_VIDEO_PIXELS || pixels > DEFAULT_MAX_REFERENCE_VIDEO_PIXELS
                    || ratio < DEFAULT_MIN_REFERENCE_VIDEO_RATIO || ratio > DEFAULT_MAX_REFERENCE_VIDEO_RATIO) {
                throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_MEDIA,
                        "参考视频宽高比或总像素不满足要求");
            }
        }
    }


    static boolean isTransientPollError(VideoProviderError error) {
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
                if (status == 429 || status == 500 || status == 502
                        || status == 503 || status == 504) {
                    return !("invalid_json_response".equals(code)
                            || "invalid_video_response".equals(code));
                }
            }
        }

        if ("invalid_json_response".equals(code) || "invalid_video_response".equals(code)) {
            return false;
        }

        return false;
    }

    private static boolean hasSocketTimeoutCause(Throwable error) {
        for (Throwable t = error; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof java.net.SocketTimeoutException && !isConnectTimeoutMessage(t.getMessage())) {
                return true;
            }
        }
        return false;
    }

    private static boolean isConnectTimeoutMessage(String message) {
        return message != null && message.toLowerCase().startsWith("connect");
    }


    static int[] resolveDimensions(Map<String, Object> input) {
        Map<String, Object> params = input.get("parameters") instanceof Map<?, ?> p
                ? castMap(p) : null;

        Object resolutionObj = input.get("resolution");
        Object aspectRatioObj = input.get("aspect_ratio");
        if (resolutionObj instanceof String resolution && aspectRatioObj instanceof String aspectRatio) {
            int[] dims = videoDimensions(resolution, aspectRatio);
            if (dims != null) return dims;
        }

        Object sizeObj = params != null ? params.get("size") : input.get("size");
        if (sizeObj instanceof String size) {
            return dimensionsFromSize(size);
        }
        return null;
    }

    private static final List<String> EDIT_INTENT_KEYWORDS = List.of(
            "编辑视频", "增加", "加上", "删除", "去掉", "修改", "替换", "改成");

    private static final List<String> PROLONG_INTENT_KEYWORDS = List.of(
            "向前延长", "向后延长", "延续", "续写");

    private static final List<String> NEGATION_KEYWORDS = List.of(
            "禁止", "不得", "不要", "不能", "勿", "无需");

    private static final String CLAUSE_SEPARATORS = "[，。；！？、,.;!?]";

    private static boolean hasIntentKeyword(String prompt, List<String> words) {
        for (String clause : prompt.split(CLAUSE_SEPARATORS)) {
            if (NEGATION_KEYWORDS.stream().anyMatch(clause::contains)) continue;
            if (words.stream().anyMatch(clause::contains)) return true;
        }
        return false;
    }

    static String resolveVideoTaskType(Object referencesRaw, String prompt) {
        boolean hasFirst = false;
        boolean hasLast = false;
        boolean hasVideoRef = false;
        if (referencesRaw instanceof List<?> list) {
            for (Object raw : list) {
                if (!(raw instanceof Map<?, ?> ref)) continue;
                String role = ref.get("role") instanceof String r ? r : "";
                String type = ref.get("type") instanceof String t ? t : "";
                if ("first_frame".equals(role)) hasFirst = true;
                else if ("last_frame".equals(role)) hasLast = true;
                else if ("reference".equals(role) && "video".equals(type)) hasVideoRef = true;
            }
        }
        if (hasFirst && hasLast) return "first_last_frame";
        if (hasFirst || hasLast) return "first_frame";
        if (!hasVideoRef) return "default";
        String p = prompt == null ? "" : prompt;
        if (hasIntentKeyword(p, PROLONG_INTENT_KEYWORDS)) return "prolong";
        if (hasIntentKeyword(p, EDIT_INTENT_KEYWORDS)) return "edit";
        return "default";
    }

    static int[] videoDimensions(String resolution, String aspectRatio) {
        Matcher resMatcher = RESOLUTION_PATTERN.matcher(resolution);
        if (!resMatcher.matches()) return null;
        if ("adaptive".equals(aspectRatio)) return null;
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


    private static String readAssetId(Object value) {
        if (value instanceof Number n) {
            long asLong = n.longValue();
            return asLong > 0 && n.doubleValue() == asLong ? String.valueOf(asLong) : null;
        }
        return (value instanceof String s && !s.isEmpty()) ? s : null;
    }

    private static List<SingleRef> readReferences(Object value) {
        if (value == null) return null;
        if (!(value instanceof List<?> list)) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE, "参考素材引用无效");
        }
        List<SingleRef> items = new ArrayList<>();
        for (Object candidate : list) {
            if (!(candidate instanceof Map<?, ?> map)) {
                throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE, "参考素材引用无效");
            }
            String role = map.get("role") instanceof String s ? s : null;
            if (!"first_frame".equals(role) && !"last_frame".equals(role) && !"reference".equals(role)) {
                throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE, "参考素材引用无效");
            }
            String type = map.get("type") instanceof String s ? s : null;
            if (!"image".equals(type) && !"video".equals(type) && !"audio".equals(type)) {
                throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_TYPE,
                        "参考素材引用类型无效");
            }
            if (map.containsKey("asset_id")) {
                String assetId = readAssetId(map.get("asset_id"));
                if (assetId == null) {
                    throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE, "参考素材引用无效");
                }
                items.add(new SingleRef(role, type, assetId, null));
            } else if (map.containsKey("material_id")) {
                String materialId = readMaterialId(map.get("material_id"));
                if (materialId == null) {
                    throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE, "素材库引用 ID 无效");
                }
                items.add(new SingleRef(role, type, null, materialId));
            } else {
                throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE, "参考素材引用无效");
            }
        }
        return items;
    }

    private static String readMaterialId(Object value) {
        if (value == null) return null;
        if (value instanceof String s && MATERIAL_ID_PATTERN.matcher(s).matches()) return s;
        throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE, "素材库引用 ID 无效");
    }

    private static String linkedMaterialId(AssetEntity asset) {
        if (asset == null) return null;
        String materialId = asset.getMaterialId();
        return (materialId != null && !materialId.isEmpty()) ? materialId : null;
    }

    private static String materialTypeOf(AssetEntity asset) {
        String type = asset != null ? asset.getType() : null;
        if ("video".equals(type)) return "video";
        if ("audio".equals(type)) return "audio";
        return "image";
    }

    private static List<MaterialRef> uniqueMaterialRefs(List<MaterialRef> refs) {
        List<MaterialRef> result = new ArrayList<>();
        for (MaterialRef ref : refs) {
            boolean seen = false;
            for (MaterialRef existing : result) {
                if (existing.id().equals(ref.id())) {
                    seen = true;
                    break;
                }
            }
            if (!seen) result.add(ref);
        }
        return result;
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
