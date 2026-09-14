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
import org.springframework.context.annotation.Conditional;
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
@Conditional(com.bluewhale.worker.config.VideoEnabledCondition.class)
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

    /** 素材库素材 id 形态（material-reference.ts:57 `^[Aa]sset-.{1,128}$`，大小写不敏感前缀）。 */
    static final Pattern MATERIAL_ID_PATTERN = Pattern.compile("^[Aa]sset-.{1,128}$");

    /**
     * 素材库引用（material-reference.ts:11-15 MaterialReference 逐字移植）。
     * <p>
     * 零本地落表：类型由创建任务时声明（素材无处可查，只能随请求携带），Worker 转成
     * {@code asset://<素材ID>} 载体交给网关；存在性/状态/物理约束由上游强校验。
     */
    record MaterialRef(String id, String type) {}

    /**
     * 单数组 references 元素（video-job-runner.ts:833-838 SingleReferenceItem 逐字移植）。
     * <p>
     * role ∈ first_frame / last_frame / reference；assetId 与 materialId 二选一（由 readReferences 收敛）。
     */
    record SingleRef(String role, String type, String assetId, String materialId) {}

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
            @org.springframework.beans.factory.annotation.Qualifier("generationMessageProducer")
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
            log.error("[video] claimVideoJobById 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error;
        }
        if (claimOpt.isEmpty()) return;

        ClaimedVideoJobDto claim = claimOpt.get();
        log.info("[video] 已领取 jobId={} token={} providerTaskId={} pollCount={}",
                claim.id(), claim.fencingToken(), claim.providerTaskId(), claim.pollCount());

        // 2. cancel before dispatch（video-job-runner.ts:213-216）
        if (claim.cancelRequested() && claim.providerTaskId() == null) {
            log.info("[video] 取消已执行(cancelBeforeDispatch) jobId={}", claim.id());
            stateMachine.cancelVideoBeforeDispatch(claim.id(), claim.workerId(), claim.fencingToken());
            return;
        }

        // 3. 取明文凭证（修正四：去密，video-job-runner.ts:218-222）
        Object credentialObj = claim.input().get("provider_credential");
        if (!(credentialObj instanceof String providerCredential) || providerCredential.isEmpty()) {
            failVideo(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "视频任务缺少供应商凭证");
            return;
        }
        String providerToken;
        try {
            providerToken = credentialService.open(providerCredential);
        } catch (Exception e) {
            log.debug("[video] 凭证无效 jobId={}: {}", claim.id(), e.getMessage(), e);
            failVideo(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "视频任务凭证无效");
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
            log.info("[video] 上游已提交 jobId={} providerTaskId={}", claim.id(), submitted.taskId());

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
                log.warn("[video] 轮询瞬时错误 jobId={} pollCount={} err={}，重排继续轮询（IKEA26）",
                        claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                boolean updated = stateMachine.rescheduleVideoPoll(
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
            log.info("[video] 上游状态终态=failed jobId={} providerTaskId={} code={} pollCount={}",
                    claim.id(), claim.providerTaskId(), code, claim.pollCount());
            failVideo(claim, code, message);
            return;
        }

        // succeeded（:297-355）
        log.info("[video] 上游状态终态=succeeded jobId={} providerTaskId={} pollCount={}",
                claim.id(), claim.providerTaskId(), claim.pollCount());
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
            log.warn("[video] 重试查上游失败 jobId={} parentTask={} err={}，按不存在处理重新 submit（IKEA26）",
                    claim.id(), claim.parentProviderTaskId(), error.getMessage(), error);
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
        log.info("[video] 转存完成 jobId={} storageKey={} size={}", claim.id(), stored.storageKey(), stored.size());

        // videoDimensions（:469-476）
        int[] dimensions = resolveDimensions(claim.input());
        if (dimensions == null) {
            failVideo(claim, GenerationError.ERROR_INVALID_INPUT, "视频尺寸无效");
            return false;
        }

        // duration（:510）
        double duration = resolveDuration(claim.input());

        // publishVideoResult（:504-512）
        boolean published = stateMachine.publishVideoResult(
                claim.id(), claim.project_id(), claim.user_id(),
                claim.workerId(), claim.fencingToken(),
                stored.url(), stored.storageKey(), stored.mime(), stored.size(),
                dimensions[0], dimensions[1], duration);
        if (published) {
            log.info("[video] 发布成功 jobId={}", claim.id());
        } else {
            log.warn("[video] 终态失败(publishVideoResult 守卫未命中) jobId={}", claim.id());
        }
        return published;
    }

    /**
     * 失败处理（video-job-runner.ts:530-558 fail）。
     */
    private void failVideo(ClaimedVideoJobDto claim, String code, String message) {
        log.warn("video job 失败 jobId={} code={} message={}", claim.id(), code, message);
        Map<String, Object> details = new HashMap<>();
        details.put("raw", message);
        // 修正一：releaseNote 整体省略（video-job-runner.ts:545 releaseNote 参数删除）
        stateMachine.failVideoJob(claim.id(), code, message, details, claim.workerId(), claim.fencingToken());
    }

    /**
     * MQ 自投延迟消息（video-queue.ts:54-62 enqueue）。
     */
    private void scheduleNext(String jobId, long delayMs) {
        try {
            producer.enqueue(jobId, delayMs);
        } catch (Exception e) {
            // Rule 6: error + rethrow as-is（不吞掉；recovery 兜底不够及时）
            log.error("[video] scheduleNext MQ 发送失败 jobId={} delayMs={}: {}", jobId, delayMs, e.getMessage(), e);
            throw e;
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
        // IKDLQG（IKFCXC 补齐组合）：目标驱动视频任务的快照携带 text_attachments（接纳时冻结的
        // 当次正文），提交时按契约确定性组合；存量任务无该字段，prompt 逐字节不变。
        Map<?, ?> plan = input.get("prompt_plan_snapshot") instanceof Map<?, ?> snapshot ? snapshot : null;
        if (input.containsKey("prompt_plan_snapshot") && (plan == null || !(plan.get("providerPrompt") instanceof String text) || text.isBlank() || !(plan.get("videoReferences") instanceof List<?>))) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_INPUT, "视频方案快照无效");
        }
        // IKFA1P：正文含文本标签时接纳侧冻结编号清单最终正文（composed_prompt），优先消费；
        // 优先级链与 TS video-job-runner 一致：providerPrompt > composed_prompt > 附件组合。
        String composedPrompt = input.get("composed_prompt") instanceof String cp && !cp.isBlank() ? cp : null;
        String prompt = plan != null ? (String) plan.get("providerPrompt")
                : composedPrompt != null ? composedPrompt
                : TextAttachmentPrompts.composeTextAttachmentPrompt(TextAttachmentPrompts.textAttachments(input), basePrompt);

        // model（:587-592）
        String model = strOrEmpty(input, "model_id");
        if (model.isEmpty() && params != null) model = strOrEmpty(params, "model_id");

        // duration（:593）
        double duration = resolveDuration(input);

        // dimensions（:594-597）；ADR-0086：adaptive 比例无固定宽高，resolveDimensions 返回 null
        // 但任务类型（首帧/编辑/延长）本就只接受 adaptive——此处 adaptive 放行，仅非 adaptive 需像素换算。
        int[] dimensions = resolveDimensions(input);
        String aspectRatio = strOrEmpty(input, "aspect_ratio");
        boolean adaptive = "adaptive".equals(aspectRatio);

        // 校验（:598-606）。ADR-0086：adaptive 比例（首帧/编辑/延长）放行；IKFPYX：duration=-1
        // （模型自动选时长）**仅 edit/prolong 任务合法**（与 backend resolveVideoTaskType 同源口径），
        // 其余任务须 duration>0 且非 adaptive 时尺寸可换算。
        String taskType = resolveVideoTaskType(input.get("references"), prompt);
        boolean autoDurationAllowed = "edit".equals(taskType) || "prolong".equals(taskType);
        boolean durationOk = Double.isFinite(duration)
                && (duration > 0 || (duration == -1 && autoDurationAllowed));
        if (prompt.isEmpty() || model.isEmpty() || !durationOk
                || (!adaptive && dimensions == null)) {
            log.warn("[IKE7JP] 前置校验遗漏：job {} 视频参数无效仍进入 worker（taskType={} duration={}）",
                    claim.id(), taskType, duration);
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
                    strOrEmpty(input, "resolution"), strOrEmpty(input, "aspect_ratio"), first, last, references);
        }

        // 参考素材解析（video-job-runner.ts:608-650）
        // IKDJNZ：单数组 references 优先（input 快照冻结，保序）；未提供回落旧字段路径。
        // IKFFWH：素材库引用（references[].material_id → asset://<id> 载体）此前整段漏移植，
        //   本段与 TS video-job-runner.ts:608-752 对齐；旧字段 material 形态（first_frame_material_id /
        //   last_frame_material_id / reference_materials）已退役——产品侧只发单数组 references。
        List<SingleRef> singleRefsRaw = readReferences(input.get("references"));

        String firstFrameAssetId = readAssetId(input.get("first_frame_asset_id"));
        String lastFrameAssetId = readAssetId(input.get("last_frame_asset_id"));
        List<String> referenceAssetIds = uniqueStrings(readAssetIds(input.get("reference_asset_ids")));
        String firstFrameMaterialId = null;
        String lastFrameMaterialId = null;
        List<MaterialRef> referenceMaterials = new ArrayList<>();

        if (singleRefsRaw != null) {
            // 单数组路径：按 role 拆帧/参考（:620-649）；asset_id（本地）与 material_id（素材库）二选一。
            firstFrameAssetId = null;
            lastFrameAssetId = null;
            referenceAssetIds = new ArrayList<>();
            firstFrameMaterialId = null;
            lastFrameMaterialId = null;
            referenceMaterials = new ArrayList<>();
            for (SingleRef ref : singleRefsRaw) {
                boolean isFirstFrame = "first_frame".equals(ref.role());
                boolean isLastFrame = "last_frame".equals(ref.role());

                // IKDJNZ review：worker 侧也守住「首尾帧必须图片」（retry 冻结快照可能含历史脏行）。
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

        // 首帧/尾帧各只能指定一个来源（:651-656）
        if (firstFrameAssetId != null && firstFrameMaterialId != null) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE, "首帧只能指定一个来源");
        }
        if (lastFrameAssetId != null && lastFrameMaterialId != null) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE, "尾帧只能指定一个来源");
        }

        // 首尾帧互斥校验（:651-663）
        boolean hasFirstFrame = firstFrameAssetId != null || firstFrameMaterialId != null;
        boolean hasLastFrame = lastFrameAssetId != null || lastFrameMaterialId != null;
        boolean hasReferences = !referenceAssetIds.isEmpty() || !referenceMaterials.isEmpty();

        if (hasLastFrame && !hasFirstFrame) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE,
                    "尾帧必须与首帧一起使用");
        }

        // 旧字段路径互斥校验（:666-671）：单数组允许首尾帧与普通参考并存（保序），旧字段路径不允许。
        if (singleRefsRaw == null && (hasFirstFrame || hasLastFrame) && hasReferences) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE,
                    "首尾帧模式不能与普通参考素材混用");
        }

        // 解析本地素材（:672-683）——素材库引用零落表，不进 assetsMap。
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

        // 首尾帧类型校验（:756-764）：本地帧素材必须是图片（关联转素材库不豁免）。
        if (firstFrame != null && !"image".equals(firstFrame.getType())) {
            throw new VideoInputError(GenerationError.ERROR_UNSUPPORTED_INPUT, "首尾帧素材必须是图片");
        }
        if (lastFrame != null && !"image".equals(lastFrame.getType())) {
            throw new VideoInputError(GenerationError.ERROR_UNSUPPORTED_INPUT, "首尾帧素材必须是图片");
        }

        // IKDJNZ：本地 Asset 命中素材库关联（assets.material_id 由素材库 CreateAsset 回写）→
        //   生成时改走素材库 id（asset://），不走本地 url；未关联照旧本地 url（:687-727）。
        String firstFrameMaterialResolved = firstFrameMaterialId != null
                ? firstFrameMaterialId : linkedMaterialId(firstFrame);
        String lastFrameMaterialResolved = lastFrameMaterialId != null
                ? lastFrameMaterialId : linkedMaterialId(lastFrame);

        // 参考素材：命中关联的本地 asset 转素材库引用，未命中的保留本地引用（:729-746）。
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

        // 合并素材库引用（显式声明 + 关联转换），按 id 去重保留首次出现（:748-752）。
        List<MaterialRef> allMaterials = new ArrayList<>(referenceMaterials);
        allMaterials.addAll(materialRefsFromAssets);
        List<MaterialRef> mergedMaterials = uniqueMaterialRefs(allMaterials);

        // 参考素材校验（:765-775 validateReferences）：本地 Asset + 素材库引用的数量并集
        List<AssetEntity> referenceAssets = new ArrayList<>();
        for (String id : unlinkedReferenceAssetIds) {
            AssetEntity asset = assetsMap.get(id);
            if (asset == null) {
                throw new VideoInputError(GenerationError.ERROR_REFERENCE_ASSET_UNAVAILABLE,
                        "参考素材不存在或无权访问");
            }
            referenceAssets.add(asset);
        }
        List<VideoReference> references = validateReferences(model, referenceAssets, mergedMaterials);

        // 构建请求（:789-829）：本地帧解析 TOS URL，素材库帧走 asset:// 载体。
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
            // 单数组语义：帧作为带 role 的 reference 条目并入（保序），避免帧/参考互斥守卫拒绝并存（:801-817）。
            List<VideoReference> merged = new ArrayList<>();
            if (firstFrameImage != null) {
                merged.add(new VideoReference("image", firstFrameImage, "first_frame"));
            }
            if (lastFrameImage != null) {
                merged.add(new VideoReference("image", lastFrameImage, "last_frame"));
            }
            merged.addAll(references);
            return new VideoSubmitInput(model, prompt, duration, resolution, ratio,
                    null, null, merged);
        }

        return new VideoSubmitInput(
                model, prompt, duration, resolution, ratio,
                firstFrameImage, lastFrameImage, references
        );
    }

    // ========== validateReferences（video-reference-validation.ts:23-95）==========

    /**
     * 参考素材校验（video-reference-validation.ts:23-95 validateReferences 逐字移植）。
     * <p>
     * 图片/视频/音频计数 + 视频物理校验 + Seedance 2.0 约束。
     */
    List<VideoReference> validateReferences(String model, List<AssetEntity> assets,
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

        // 素材库引用：并入图/视频/音频数量并集与 Seedance 2.0 约束；
        // 物理校验只作用于本地 Asset（素材库素材由上游强校验）。(video-reference-validation.ts:56-67)
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

    /** 便捷重载：无素材库引用时只校验本地 Asset（materials 传空表）。 */
    List<VideoReference> validateReferences(String model, List<AssetEntity> assets) {
        return validateReferences(model, assets, List.of());
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

    /** IKFPYX：编辑意图关键词（官方：「编辑视频、增加/加上、删除/去掉、修改/替换/改成」）。 */
    private static final List<String> EDIT_INTENT_KEYWORDS = List.of(
            "编辑视频", "编辑", "增加", "加上", "删除", "去掉", "修改", "替换", "改成");

    /** IKFPYX：延长意图关键词（官方：「向前/向后延长、延续、续写」）。 */
    private static final List<String> PROLONG_INTENT_KEYWORDS = List.of(
            "延长", "延续", "续写", "向前", "向后");

    /** IKFPYX：判定视频任务类型（与 backend `contracts/capability-param-validation.ts`
     *  resolveVideoTaskType 同源口径，两端不得各自发明）。
     *  优先级：首尾帧角色 > 单帧角色 > 参考视频 + 提示词意图（延长先于编辑，后者词面更宽）> default。 */
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
        for (String w : PROLONG_INTENT_KEYWORDS) if (p.contains(w)) return "prolong";
        for (String w : EDIT_INTENT_KEYWORDS) if (p.contains(w)) return "edit";
        return "default";
    }

    static int[] videoDimensions(String resolution, String aspectRatio) {
        Matcher resMatcher = RESOLUTION_PATTERN.matcher(resolution);
        if (!resMatcher.matches()) return null;
        // ADR-0086：adaptive 自适应比例无固定宽高比，不换算像素（输出与输入素材一致，由上游决定）。
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

    /** 素材 id 解析（material-reference.ts:52-57 readAssetId）：接受 JSON 数字与纯数字串形态。 */
    private static String readAssetId(Object value) {
        if (value instanceof Number n) {
            long asLong = n.longValue();
            return asLong > 0 && n.doubleValue() == asLong ? String.valueOf(asLong) : null;
        }
        return (value instanceof String s && !s.isEmpty()) ? s : null;
    }

    /**
     * 解析单数组 references（video-job-runner.ts:832-876 readReferences 逐字移植）。
     * <p>
     * 未提供（null）→ 返回 null，回落旧字段路径；形状/枚举非法 → invalid_reference(_type)。
     * worker 侧不信任冻结快照：非数组不得静默退化成「无参考提交」（那正是 IKFFWH 的症状）。
     */
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

    /**
     * 解析素材库素材 id（material-reference.ts:59-63 readMaterialId）。
     * <p>
     * 缺省 → null；形态非法 → invalid_reference（`^[Aa]sset-.{1,128}$`，前缀大小写不敏感）。
     */
    private static String readMaterialId(Object value) {
        if (value == null) return null;
        if (value instanceof String s && MATERIAL_ID_PATTERN.matcher(s).matches()) return s;
        throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE, "素材库引用 ID 无效");
    }

    /** 本地 Asset 的素材库关联（assets.material_id 非空即命中，video-job-runner.ts:691-695 isLinked）。 */
    private static String linkedMaterialId(AssetEntity asset) {
        if (asset == null) return null;
        String materialId = asset.getMaterialId();
        return (materialId != null && !materialId.isEmpty()) ? materialId : null;
    }

    /** 本地 Asset 转素材库引用时的类型归一（video-job-runner.ts:736-741）。 */
    private static String materialTypeOf(AssetEntity asset) {
        String type = asset != null ? asset.getType() : null;
        if ("video".equals(type)) return "video";
        if ("audio".equals(type)) return "audio";
        return "image";
    }

    /** 素材库引用按 id 去重（保留首次出现，material-reference.ts:86-92 uniqueMaterialRefs）。 */
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
