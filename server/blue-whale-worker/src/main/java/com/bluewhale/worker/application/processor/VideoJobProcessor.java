package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedVideoJobDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.GenerationErrorDetailContract;
import com.bluewhale.worker.domain.contract.GenerationMqRouteEnum;
import com.bluewhale.worker.domain.contract.VideoSampleContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoInputError;
import com.bluewhale.worker.domain.error.VideoProviderError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
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

/**
 * 视频作业处理器（video-job-runner.ts:195-376 runVideoJobStep 逐字移植）。
 * <p>
 * 编排流程（与音频/图片不同：视频是多步状态机，每步 = 一次 MQ 消费）：
 * <ol>
 *   <li>claimVideoJobById（富投影：pollCount/progress/providerTaskId/parentProviderTaskId）</li>
 *   <li>cancelRequested AND providerTaskId==null → cancelVideoBeforeDispatch</li>
 *   <li>providerTaskId==null → (a) parent-reuse 防双扣 → (b) buildSubmitRequest → submit →
 *       markProviderSubmitted → scheduleNext(5s)；IKIZQD：submit/finalize 前先落
 *       markSubmissionAttempt（processing→checking「提交中」），结果不明留 checking 锁定
 *       （不重提不退款），见 {@link #dispatchSubmission}</li>
 *   <li>providerTaskId!=null → poll → transient → rescheduleProviderPoll(5s)（与
 *       processing 共享 720 轮询预算，超限同归 provider_timeout）;
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

    /**
     * IKJ80P：submit 阶段超时落终态时写进 {@code error.details} 的孤儿标记键。
     * <p>
     * 场景：worker submit 读超时断开，但 new-api 网关/上游随后仍完成建单并扣量——
     * {@code provider_task_id} 无从取得（网关无按条件查询已建任务的接口），本 job 只能落
     * 显式失败终态，上游任务成为疑似孤儿。键落 {@code true} 供告警与对账；与
     * {@link GenerationErrorDetailContract#ERROR_DETAIL_HTTP_STATUS} 不同，这是 worker 侧
     * 单端运维键（backend 无消费方），故不放跨族契约类。
     * <p>
     * 可审计孤儿清单（对账入口）＝按本键查询：
     * <pre>{@code
     * SELECT id, user_id, project_id, gmt_create, error->>'$.message' AS msg
     * FROM generation_jobs
     * WHERE type = 'video' AND status = 'failed'
     *   AND provider_task_id IS NULL
     *   AND JSON_EXTRACT(error, '$.details.submit_timeout_orphan') = CAST('true' AS JSON);
     * }</pre>
     */
    public static final String ERROR_DETAIL_SUBMIT_TIMEOUT_ORPHAN = "submit_timeout_orphan";

    // ========== 参考视频校验常量（video-reference-validation.ts） ==========
    // 平台物理约束——**不是模型知识，能力行无对应字段**（运营改不了，也不会为它们新增配置列）：
    // 单视频字节 / 单边像素 / 总像素 / 宽高比 / 单视频最短时长 / mime 白名单。
    //
    // DEFAULT_* 语义：**无配置可读时的缺省**，不是「配置的兜底」——没有配置字段，所以无条件
    // 生效，这是设计如此。命名与 TS 镜像（generation-runtime/video-reference-validation.ts
    // 同名 DEFAULT_*）保持一致。
    // 参考数量与时长上限全部读能力行（见下）。

    static final long DEFAULT_MAX_REFERENCE_VIDEO_BYTES = 200L * 1024 * 1024;
    static final int DEFAULT_MIN_REFERENCE_VIDEO_SECONDS = 2;
    static final int DEFAULT_MIN_REFERENCE_VIDEO_SIDE = 300;
    static final int DEFAULT_MAX_REFERENCE_VIDEO_SIDE = 6000;
    static final int DEFAULT_MIN_REFERENCE_VIDEO_PIXELS = 409_600;
    static final int DEFAULT_MAX_REFERENCE_VIDEO_PIXELS = 8_295_044;
    static final double DEFAULT_MIN_REFERENCE_VIDEO_RATIO = 0.4;
    static final double DEFAULT_MAX_REFERENCE_VIDEO_RATIO = 2.5;
    static final Set<String> DEFAULT_REFERENCE_VIDEO_MIMES = Set.of("video/mp4", "video/quicktime");

    /**
     * IKHBDO 迁移兜底：旧在飞 job 的 input 里没有冻结的 {@code reference_limits}（本次变更前创建），
     * 此时按旧常量判定，保证上线不打断在途任务。
     * <p>
     * ⚠️ 这三个常量**不是真相来源**——新 job 一律读接纳侧冻结的能力行值
     * （{@code backend} handle-create-generation-job videoStrategy.composeInput）。
     * <p>
     * IKHEXG：冻结快照的键名随参考上限键族一并改名（{@code max_reference_images} →
     * {@code image_reference_max}）。本进程**只读新键、不读旧键**——IKHEXG 决策为
     * 「不考虑在途」，即快照仍是旧键的在飞 job（IKHBDO 之后、IKHEXG 之前创建）在此回落本组
     * 常量，而不是读出它们冻结的配置值。这是有意的取舍，不是漏读。
     */
    static final int LEGACY_MAX_REFERENCE_IMAGES = 9;
    static final int LEGACY_MAX_REFERENCE_VIDEOS = 3;
    static final int LEGACY_MAX_REFERENCE_VIDEO_SECONDS = 15;

    /**
     * 参考素材上限（全部来自能力行 features，接纳侧冻结进 {@code input.reference_limits}）。
     *
     * @param maxDurationSec 能力行 max_reference_duration_sec；null = 未配置 → 不限。
     */
    record ReferenceLimits(int maxImages, int maxVideos, int maxAudios, Integer maxDurationSec) {}

    /** 旧 job 兜底（无冻结快照时按旧常量判定）。 */
    static final ReferenceLimits LEGACY_REFERENCE_LIMITS = new ReferenceLimits(
            LEGACY_MAX_REFERENCE_IMAGES, LEGACY_MAX_REFERENCE_VIDEOS,
            LEGACY_MAX_REFERENCE_VIDEOS, LEGACY_MAX_REFERENCE_VIDEO_SECONDS);

    /**
     * 读冻结的参考上限（IKHBDO）：{@code input.reference_limits} 由接纳侧按能力行写入，
     * 本进程只读、不含任何模型知识。
     * <p>
     * 兜底口径（只服务旧在飞 job，不作为真相来源）：整字段缺失 → 全部回落旧常量；
     * 单字段缺失 → 该字段回落旧常量；{@code max_reference_duration_sec} 显式 null → 不限
     * （能力行没配上限），只有 key 都不存在时才回落旧 15 秒。
     */
    static ReferenceLimits referenceLimitsOf(Map<String, Object> input) {
        if (!(input.get("reference_limits") instanceof Map<?, ?> raw)) {
            return LEGACY_REFERENCE_LIMITS;
        }
        Map<String, Object> limits = castMap(raw);
        // 不能用三元：int 分支会触发 Integer 拆箱，显式 null 时 NPE。
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

    /** 非负整数（含 0，参考上限允许显式 0）；非法/缺失回落 fallback。 */
    private static int intOr(Object value, int fallback) {
        return value instanceof Number n && n.intValue() >= 0 ? n.intValue() : fallback;
    }

    /** 正数；非法/缺失/null 一律 null（= 不限）。 */
    private static Integer positiveIntOrNull(Object value) {
        return value instanceof Number n && n.intValue() > 0 ? n.intValue() : null;
    }

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

    /** resolution → height 解析。 */
    private static final Pattern RESOLUTION_PATTERN = Pattern.compile("^([0-9]+)p$");
    /** aspect_ratio → w:h 解析。 */
    private static final Pattern RATIO_PATTERN = Pattern.compile("^([1-9][0-9]*):([1-9][0-9]*)$");
    /** size → WxH 解析。 */
    private static final Pattern SIZE_PATTERN = Pattern.compile("^([0-9]+)x([0-9]+)$", Pattern.CASE_INSENSITIVE);

    private final JobStateMachineService stateMachine;
    private final JobFinalizer finalizer;
    private final AssetSourceService assetSource;
    private final GenerationCredentialService credentialService;
    private final NewApiVideoClient videoClient;
    private final TosVideoMediaRelay mediaRelay;
    private final GenerationMessageProducer producer;
    private final String workerId;

    @org.springframework.beans.factory.annotation.Autowired
    public VideoJobProcessor(
            JobStateMachineService stateMachine,
            JobFinalizer finalizer,
            AssetSourceService assetSource,
            GenerationCredentialService credentialService,
            NewApiVideoClient videoClient,
            TosVideoMediaRelay mediaRelay,
            @org.springframework.beans.factory.annotation.Qualifier("generationMessageProducer")
            GenerationMessageProducer producer
    ) {
        this(stateMachine, finalizer, assetSource, credentialService, videoClient, mediaRelay, producer,
                "video-" + hostname() + "-" + ProcessHandle.current().pid());
    }

    VideoJobProcessor(
            JobStateMachineService stateMachine,
            JobFinalizer finalizer,
            AssetSourceService assetSource,
            GenerationCredentialService credentialService,
            NewApiVideoClient videoClient,
            TosVideoMediaRelay mediaRelay,
            GenerationMessageProducer producer,
            String workerId
    ) {
        this.stateMachine = stateMachine;
        this.finalizer = finalizer;
        this.assetSource = assetSource;
        this.credentialService = credentialService;
        this.videoClient = videoClient;
        this.mediaRelay = mediaRelay;
        this.producer = producer;
        this.workerId = workerId;
    }

    @Override
    public String tag() {
        return GenerationMqRouteEnum.VIDEO.tag();
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
            Integer httpStatus = NewApiHttpSupport.upstreamHttpStatus(error);
            if (httpStatus != null) {
                // 状态已结构化落 details（IKIMS5），message 不再重复携带状态码字样：只剥网关
                // 文案的「: HTTP <code>」片段，上游原因 / body 等排查信息原样保留。结果下载
                // 失败等纯排查文案无状态 cause（httpStatus=null），不受影响、永远保留字样
                message = message.replaceAll(": HTTP " + httpStatus + "\\b", ":");
            }
            // IKJ80P 孤儿标记判定——IKIZQD 起不再命中：submit 阶段异常已由
            // dispatchSubmission 消化（读超时/响应丢失留 checking 锁定，不重提不退款；
            // 网关拒绝挂 HTTP cause 重抛，不命中 SocketTimeout 判定）；poll 阶段
            // providerTaskId 必非 null。本布尔因此恒 false，孤儿标记不再新写——键名、
            // 分支与对账 SQL（ERROR_DETAIL_SUBMIT_TIMEOUT_ORPHAN）仅为 IKJ80P 时代
            // 写入的存量历史行保留。
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

    /**
     * 视频步骤主逻辑（video-job-runner.ts:224-356 try 块）。
     */
    private void runVideoStep(ClaimedVideoJobDto claim, String providerToken) {
        if (claim.providerTaskId() == null) {
            // ========== submit 阶段（video-job-runner.ts:226-243）==========

            // IKEA26：parent-reuse 防双扣（:232-235）；true = 收割路径已终局（已发布或失租停止，IKICD3）
            if (claim.parentProviderTaskId() != null) {
                boolean settled = tryReuseParentResult(claim, providerToken);
                if (settled) return;
            }

            // IKIZQC：成片（video_stage='final'）提交相——不重建 Draft 输入，用样片保存的
            // 网关公开 task ID 调 finalize（网关自行组装 draft_task 引用，私有上游 ID
            // 不出网关）。返回的公开任务 ID 即成片轮询句柄，后续 pollPhase 与普通视频同构。
            if ("final".equals(claim.videoStage())) {
                submitFinalize(claim, providerToken);
                return;
            }

            // buildSubmitRequest（:236）
            VideoSubmitInput request = buildSubmitRequest(claim);

            // submit（:237）——IKIZQD：先持久「提交中」标记再发网关（普通/样片同骨架）
            dispatchSubmission(claim, () -> videoClient.submit(providerToken, request));
        } else {
            // ========== poll 阶段（video-job-runner.ts:246-355）==========
            pollPhase(claim, providerToken);
        }
    }

    /**
     * IKIZQD 提交相公共骨架（契约 §六 JOB_STATUS_CHECKING）：普通 / 样片 submit 与成片
     * finalize 共用——「Worker 调网关前持久标记提交中」。
     * <ol>
     *   <li>{@code markSubmissionAttempt} 先落 checking：守卫未命中 = 失租 / 已提交 / 已终态，
     *       停止且**绝不发网关**（迟到 Worker 的 fence）；</li>
     *   <li>调网关；</li>
     *   <li>明确受理 → {@code markProviderSubmitted} 从 checking 恢复 processing 并落轮询句柄
     *       （「明确成功恢复原任务」），后续 poll 与普通视频同构。</li>
     * </ol>
     * 结果分类（父规格 IKIZPZ「提交与恢复」）：
     * <ul>
     *   <li>带 HTTP 状态的拒绝（网关已答复业务回绝）= 明确失败 → 上抛顶层 catch 统一归类，
     *       failVideoJob 从 checking 落失败终态并释放本阶段预扣；</li>
     *   <li>超时、响应丢失、解析失败等**无可用响应**，以及 {@code markProviderSubmitted}
     *       落库失败 = 结果不明 → 留在 checking 锁定：不按空 provider_task_id 重提、不自动
     *       退款，记 submission_unknown 日志供人工核对。checking 不被 claim 候选与恢复扫描
     *       选中，同键重放 / 并发 / 重启后至多一次已发上游的尝试与一笔预扣。</li>
     * </ul>
     * 恢复核对的数据面即本仓行（status=checking + charge_state='held' + input）与网关 /
     * 上游后台账单；网关无「按样片查成片」契约（IKIZI7），首版不建自动对账，仍不明交人工。
     */
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
                // 网关明确拒绝（有 HTTP 答复）：明确失败，走顶层 catch → failVideo（释放预扣）
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
            // 落库失败：网关已受理但轮询句柄未落——结果不明，留 checking（绝不能 failVideo：
            // 守卫会命中 checking 行并把预扣退掉，那正是本票要关的提前退款窗口）
            recordSubmissionUnknown(claim, error);
            return;
        }
        if (updated) {
            scheduleNext(claim.id(), VIDEO_POLL_INTERVAL_MS);
        }
    }

    /**
     * IKIZQD：结果不明留痕（best-effort）——checking 行 + charge_state='held' 是人工核对的
     * 主数据，这里补「为何不明」。日志落库失败不抛：任务仍处锁定，不能因记日志失败改道。
     *
     * <p>人工核对入口（契约 §六）：checking 是一等 status，对账清单直接按状态查。
     * ⚠️ **IKJCOE**：`video_stage` / `charge_state` 已搬进 `generation_job_extras`
     * （ADR-0120），不再是主表列——两列改从扩展位取，否则本查询会以 1054
     * 「Unknown column」失败，恰在有人要解一笔卡单的时候：
     * <pre>{@code
     * SELECT j.id, j.user_id, j.project_id, j.provider_task_id, j.gmt_create,
     *        stage.value_text AS video_stage, charge.value_text AS charge_state
     * FROM generation_jobs j
     * LEFT JOIN generation_job_extras stage
     *        ON stage.generation_job_id = j.id AND stage.extra_key = 'video_stage'
     * LEFT JOIN generation_job_extras charge
     *        ON charge.generation_job_id = j.id AND charge.extra_key = 'charge_state'
     * WHERE j.type = 'video' AND j.status = 'checking';
     * }</pre>
     * 逐行核对本仓 input、网关任务、上游结果与账单四方后按契约三选一：明确成功恢复原
     * 任务，明确失败释放该阶段预扣，仍不明保持锁定。核对期间预扣持留、再次提交被
     * 1014 submission_unknown 拒绝；checking 行不被 claim 候选与恢复扫描选中，不会
     * 被自动重提。
     */
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

    /**
     * IKIZQC：成片提交相（金标 G02/G14）。缺来源样片上游任务 ID = 数据异常（成片行
     * 必然带 source_sample_job_id，样片成功终态必然带 provider_task_id），按本阶段失败
     * 处理——不猜、不回退成普通 submit（那会凭空建一条无 Draft 引用的上游任务）。
     * 这是**本地前置校验且未发网关**的错误：不落「提交中」标记、不占上游尝试（IKIZQD），
     * 直接 failVideoGuard 置 charge_state='released' 并发该阶段返还事件（样片阶段的结算
     * 不受影响，金标 G09）。其余提交路径统一走 {@link #dispatchSubmission}（IKIZQD）。
     */
    private void submitFinalize(ClaimedVideoJobDto claim, String providerToken) {
        String sampleTaskId = claim.sourceSampleProviderTaskId();
        if (sampleTaskId == null || sampleTaskId.isEmpty()) {
            log.error("[video] 成片缺少来源样片上游任务 ID，按本阶段失败处理 jobId={}", claim.id());
            failVideo(claim, GenerationError.ERROR_INVALID_INPUT, "成片缺少来源样片的上游任务 ID");
            return;
        }
        dispatchSubmission(claim, () -> videoClient.finalize(providerToken, sampleTaskId));
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
                // 轮询上限对瞬时错误同样生效（IKI61M，对齐 IKI4M4 调速先例）：上游持续故障
                // （超时 / 429 / 5xx）时每次瞬时错误都走续排，poll_count 由
                // rescheduleProviderPoll 同一 SQL 累计（与 processing 分支共享预算）——
                // 若此处不判上限，poll_count 涨到 720 也进不了失败终态，卡片永远停在
                // 生成中。与 processing 分支同一判定、同一兜底码，文案附上游错误摘要（IKIHKR）。
                if (claim.pollCount() >= MAX_VIDEO_POLLS) {
                    log.warn("[video] 轮询瞬时错误且已达轮询上限 jobId={} pollCount={} err={}，归失败终态",
                            claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                    // IKIN6Y：预算耗尽分支与顶层 catch（IKIMS5 / IKIMN8）同一透传口径——状态从
                    // 当次瞬时错误的 cause 链解析（共享 NewApiHttpSupport.upstreamHttpStatus）：
                    // 取到才写 details.http_status 并剥 message 的「: HTTP <code>」片段（body /
                    // request_id 等排查信息原样保留）；取不到（超时 / 连接失败等无状态 cause）
                    // 不写键、不推断状态，文案保持现状。
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
            // video-job-runner.ts:266-286
            log.debug("video job 轮询中 jobId={} status={} progress={}",
                    claim.id(), observation.status(), observation.progress());

            // poll 超限 → provider_timeout（:272-279）
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
     * IKEA26：parent-reuse 防双扣（video-job-runner.ts:424-453 tryReuseParentResult）；
     * IKICD3：失租后停止重复提交。
     * <p>
     * 父 job 的 provider_task_id 对应的上游 task SUCCESS → 复用其结果 URL 走 publishVideoResult。
     * FAILED / 不存在 / 查询失败 / 结果 URL 为 null 或空白 / 转存或发布异常 → 返回 false（走现有 submit 逻辑重新生成）。
     * <p>
     * IKICD3 边界：已取得旧结果但发布守卫（publishVideoGuard CAS：status=processing +
     * lease_owner + fencing_token）未命中，说明当前 Worker 已失去该 GenerationJob 的执行权
     * （新 Worker 接管租约或 job 已终态），此时返回 true 终止本路径：不调用上游 submit、
     * 不记录新 provider_task_id、不安排本轮询、不写迟到 Finalize；新 Worker 领取后沿同一路径
     * 继续收割。回退重新提交只发生在「旧结果不可用」形态，与「失去执行权而停止」以日志区分。
     * 与八家族共享骨架（ParentResultReuse）「守卫未命中回退提交」的定版口径刻意不同——
     * 视频为计费家族，失租后重复提交产生无主上游费用，先行修正（ADR-0114）。
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

        if (!"succeeded".equals(observation.status())
                || observation.url() == null || observation.url().isBlank()) {
            log.info("[video] 重试收割未命中(旧结果不可用) jobId={} parentTask={} status={}，回退重新提交",
                    claim.id(), claim.parentProviderTaskId(), observation.status());
            return false;
        }

        // 复用结果 → publishVideo（:448-452）
        boolean published;
        try {
            published = publishVideo(claim, observation);
        } catch (Exception error) {
            // 转存/发布异常按「旧结果不可用」回退重新提交（对齐共享骨架
            // ParentResultReuse「发布异常走回退分支兜底」口径），不把手动重试写成终态失败
            log.warn("[video] 重试收割发布异常(旧结果不可用) jobId={} parentTask={} err={}，回退重新提交",
                    claim.id(), claim.parentProviderTaskId(), error.getMessage(), error);
            return false;
        }
        if (!published) {
            // IKICD3：守卫未命中 = 租约丢失或已终态，当前 Worker 不再代表该 job，停止而非回退提交
            log.warn("[video] 重试收割失去执行权 jobId={} parentTask={}（发布守卫未命中：stale/租约失效/已终态），停止不再重新提交（IKICD3）",
                    claim.id(), claim.parentProviderTaskId());
        }
        return true;
    }

    /**
     * 视频结果发布（video-job-runner.ts:457-528 publishVideo）。
     * <p>
     * relay.persist → videoDimensions → publishVideoResult。
     * <p>
     * 修正一：quota/actualAmountFen 偏差告警段整体省略。
     * <p>
     * IKIZQ8 样片差异（金标 G14/G06）：① 样片**禁用**「TOS 未配置则直存供应商 URL」的
     * 普通视频降级——24 小时/100 次的临时链接不构成自有素材交付，转存不可用即按本阶段
     * 失败处理（预扣随终态守卫释放）；② 样片成功终态附带可信上游 created_at 与按契约
     * 公式算出的转成片截止，缺可信时间时截止为 null（样片仍交付，成片禁用）。
     * IKIZQC：G14 对**成片**同规（两阶段成功前必须转存自有 Asset）——禁降级判定从
     * input.sample_mode 扩展为「样片或成片阶段」；成片独立转存、独立结算（本 job 的
     * totalTokens 即成片阶段真实用量），来源样片不动。
     */
    private boolean publishVideo(ClaimedVideoJobDto claim, VideoTaskObservation observation) {
        boolean sample = Boolean.TRUE.equals(
                claim.input().get(VideoSampleContract.INPUT_SAMPLE_MODE));
        boolean twoPhase = sample || "final".equals(claim.videoStage());
        // relay persist（:468）
        StoredVideo stored;
        if (mediaRelay != null) {
            stored = mediaRelay.persist(observation.url(), claim.user_id());
        } else if (twoPhase) {
            // G14：两阶段（样片/成片）禁用供应商 URL 直存降级——转存失败不能以临时链接充当成功结果。
            log.error("[video] 两阶段结果转存不可用（TOS 未配置），按本阶段失败处理（不保存供应商 URL）jobId={}",
                    claim.id());
            failVideo(claim, GenerationError.ERROR_PROVIDER_FAILED, "视频结果转存不可用，已按失败处理");
            return false;
        } else {
            // TOS 未配置 → 降级直存 URL（与 image 同构，普通视频既有语义不动）
            // IKGS73：这条路上我们**没有字节**（只有供应商 URL），所以 md5 传 null——
            // 这是本单显式接受的边界（工单「明确不做」里的 B 类）。要补它得把整段视频
            // 拉下来算哈希（上限 200MB），不在这单的取舍内。
            log.warn("[video] TOS 未配置，降级直存供应商 URL：assets.md5 将为空（IKGS73 已知边界）");
            stored = new StoredVideo(observation.url(), null, null, null, null);
        }
        log.info("[video] 转存完成 jobId={} storageKey={} size={}", claim.id(), stored.storageKey(), stored.size());

        // videoDimensions（:469-476）；ADR-0086：adaptive 比例无固定宽高（首帧/编辑/延长任务），
        // 尺寸可空——不再视为失败（asset 的 width/height 列可空），否则生成成功的 adaptive 视频发布不出去。
        int[] dimensions = resolveDimensions(claim.input());
        Integer width = dimensions != null ? dimensions[0] : null;
        Integer height = dimensions != null ? dimensions[1] : null;

        // duration（:510）
        double duration = resolveDuration(claim.input());

        // IKIZQ8：可信上游 created_at → 转成片截止（契约同一公式，金标 G06 跨语言对账）。
        // 缺可信时间：两值都传 null——样片照常交付，deadline 列为 null（服务端据此禁成片）。
        Long upstreamCreatedAtMs = sample ? observation.upstreamCreatedAtMs() : null;
        Long finalizeDeadlineMs = sample && upstreamCreatedAtMs != null
                ? VideoSampleContract.finalizeDeadlineMs(upstreamCreatedAtMs) : null;

        // publishVideoResult（:504-512）。
        // 上游真实 token 一并交给终态收口：它是**结算的权威用量**（按 token 计价的模型靠它），
        // 而这里正是**唯一**拿得到轮询结果的地方——终态事件由 finalizer 发出，晚了就没了。
        boolean published = finalizer.publishVideoResult(
                claim.id(), claim.project_id(), claim.user_id(),
                claim.workerId(), claim.fencingToken(),
                stored.url(), stored.storageKey(), stored.mime(), stored.size(), stored.md5(),
                width, height, duration, observation.totalTokens(),
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

    /**
     * 失败处理（video-job-runner.ts:530-558 fail）。非 HTTP 失败路径统一走它，details 不含状态键。
     */
    private void failVideo(ClaimedVideoJobDto claim, String code, String message) {
        failVideo(claim, code, message, null);
    }

    /** details 落结构化上游 HTTP 状态（IKIMS5，音频提取 IKIMS2 同款）：判定读
     *  {@link GenerationErrorDetailContract#ERROR_DETAIL_HTTP_STATUS} 不依赖文案；非 HTTP
     *  失败（超时 / 连接失败 / 业务信封失败 / 结果下载失败）不写该键。submit 阶段网关
     *  !2xx 不带 cause 是已知现状，缺键语义 = 无非 HTTP 状态可读。 */
    private void failVideo(ClaimedVideoJobDto claim, String code, String message, Integer httpStatus) {
        failVideo(claim, code, message, httpStatus, false);
    }

    /**
     * IKJ80P 带孤儿标记的失败收口：submitTimeoutOrphan=true 时额外写
     * {@link #ERROR_DETAIL_SUBMIT_TIMEOUT_ORPHAN}（error.details 结构化键，SQL 可查）。
     */
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
        // 修正一：releaseNote 整体省略（video-job-runner.ts:545 releaseNote 参数删除）
        finalizer.failVideoJob(claim.id(), code, message, details, claim.workerId(), claim.fencingToken());
    }

    /**
     * MQ 自投延迟消息（generation-queue.ts:54-62 enqueue）。
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
     * 校验：prompt/model/duration → invalid_input (:598-606)。
     * 参考校验：单数组 references 优先 → 旧字段路径。
     */
    VideoSubmitInput buildSubmitRequest(ClaimedVideoJobDto claim) {
        Map<String, Object> input = claim.input();
        Map<String, Object> params = input.get("parameters") instanceof Map<?, ?> p
                ? castMap(p) : null;
        // IKIZQ8：样片标记（接纳侧冻结进 input.sample_mode）——提交体带 draft:true 走 480p Draft。
        boolean sample = Boolean.TRUE.equals(input.get(VideoSampleContract.INPUT_SAMPLE_MODE));

        // prompt（:571-586）
        String basePrompt = strOrEmpty(input, "prompt");
        if (basePrompt.isEmpty()) basePrompt = strOrEmpty(input, "prompt_text");
        // 方案快照仍供下方组装 videoReferences（首尾帧/参考素材），但不再提供正文。
        Map<?, ?> plan = input.get("prompt_plan_snapshot") instanceof Map<?, ?> snapshot ? snapshot : null;
        if (input.containsKey("prompt_plan_snapshot") && (plan == null || !(plan.get("videoReferences") instanceof List<?>))) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_INPUT, "视频方案快照无效");
        }
        // IKG6EK / ADR-0088：正文唯一来源是冻结的 input.prompt——接纳侧已完成引用标记转移
        // （&asset_id& → @图片N）与附件拼装，执行与重试不得重新拼接覆盖它。
        // 原 providerPrompt > composed_prompt > 附件组合三级优先链全部退役。
        String prompt = basePrompt;

        // model（:587-592）
        String model = strOrEmpty(input, "model_id");
        if (model.isEmpty() && params != null) model = strOrEmpty(params, "model_id");

        // duration（:593）
        double duration = resolveDuration(input);

        // IKG0LP：视频是否带音频。接纳侧仅在能力位 features.audio 允许时冻结该字段；
        // 缺失或非布尔 → null → 出站不下发，维持上游默认。
        Boolean generateAudio = input.get("generate_audio") instanceof Boolean b ? b : null;

        // 校验（:598-606）。IKFPYX：duration=-1（模型自动选时长）**仅 edit/prolong 任务合法**，
        // 其余任务须 duration>0。
        // 判定用**主提示词**（basePrompt）而非组合后 prompt：官方口径是「提示词中需包含关键词」，
        // 文本附件属创作上下文不计入；与 backend handle-create-generation-job 用的 params.prompt 同源。
        // IKG0FR：不再要求 resolution 能换算成像素——分辨率合法性由提交时的能力行白名单负责，
        // 像素只用于回写 assets.width/height（列可空），换算不出写 null 即可，不拒单。
        String taskType = resolveVideoTaskType(input.get("references"), basePrompt);
        boolean autoDurationAllowed = "edit".equals(taskType) || "prolong".equals(taskType);
        boolean durationOk = Double.isFinite(duration)
                && (duration > 0 || (duration == -1 && autoDurationAllowed));
        if (prompt.isEmpty() || model.isEmpty() || !durationOk) {
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
                    strOrEmpty(input, "resolution"), strOrEmpty(input, "aspect_ratio"), first, last, references,
                    generateAudio, sample);
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

        // 参考素材校验：本地 Asset + 素材库引用的数量并集；上限读接纳侧冻结的能力行值（IKHBDO）
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
                    null, null, merged, generateAudio, sample);
        }

        return new VideoSubmitInput(
                model, prompt, duration, resolution, ratio,
                firstFrameImage, lastFrameImage, references, generateAudio, sample
        );
    }

    // ========== validateReferences（video-reference-validation.ts validateReferences）==========

    /**
     * 参考素材校验（video-reference-validation.ts validateReferences 逐字移植）。
     * <p>
     * 图片/视频/音频计数 + 视频物理校验。上限全部来自 {@code limits}（能力行冻结值，IKHBDO）——
     * 本方法不含任何按模型名推导的规则。
     */
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

        // 素材库引用：并入图/视频/音频数量并集与能力行上限；
        // 物理校验只作用于本地 Asset（素材库素材由上游强校验）。
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

        // 计数校验：上限读能力行，文案与判定顺序对齐接纳侧 checkReferenceLimits。
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

        // 参考视频 / 参考音频的「模型是否支持」**不在这里判**。
        // 这条规则曾经是本文件里的 `isSeedance2Model(SEEDANCE2_PATTERN)` 前缀特判，
        // 逐个字从已退役的 node worker 移植而来，与能力行数据相反：
        //   - 它给 Seedance 2.0 放行，而能力行 features.video_reference = false
        //   - 它把 Seedance 2.5 拒掉（抛 unsupported_input「只有 Seedance 2.0 支持…」），
        //     而能力行 features.video_reference = true，2.5 还正是默认选中模型
        // 接纳侧（backend handle-create-generation-job）已按能力行校验过（video_reference /
        // audio_reference），此处再按模型名推一遍只会把正确的请求拦掉。
        // 模型名会随目录新增而失效，能力位不会——因此只留上游那一道闸门。

        // 视频时长累计校验：上限读能力行（未配 = 不限）
        if (limits.maxDurationSec() != null && knownVideoDuration > limits.maxDurationSec()) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_MEDIA,
                    "参考视频已知总时长不能超过 " + limits.maxDurationSec() + " 秒");
        }

        return references;
    }

    /** 便捷重载：无素材库引用时只校验本地 Asset（materials 传空表）。 */
    List<VideoReference> validateReferences(ReferenceLimits limits, List<AssetEntity> assets) {
        return validateReferences(limits, assets, List.of());
    }

    /**
     * 单个参考视频物理校验（video-reference-validation.ts validateReferenceVideo）。
     * <p>
     * 边界包含性（与 TS 逐字一致）：
     * size: &gt;200MB 失败 → 200MB 恰好通过
     * duration: &lt;2 或 &gt;maxDurationSec 失败 → 边界恰好通过（maxDurationSec=null → 只卡下限）
     * side: &lt;300 或 &gt;6000 → 300/6000 恰好通过
     * pixels: &lt;409600 或 &gt;8295044 → 边界恰好通过
     * ratio: &lt;0.4 或 &gt;2.5 → 边界恰好通过
     *
     * @param maxDurationSec 能力行 max_reference_duration_sec（冻结值）；null = 未配 → 不设上限。
     */
    void validateReferenceVideo(AssetEntity asset, Integer maxDurationSec) {
        // mime
        if (asset.getMime() != null) {
            String mime = asset.getMime().split(";", 2)[0].trim().toLowerCase();
            if (!DEFAULT_REFERENCE_VIDEO_MIMES.contains(mime)) {
                throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_MEDIA,
                        "参考视频只支持 MP4 或 MOV");
            }
        }

        // size：>200MB 失败 → 200MB 恰好通过（`>` 非 `>=`）
        if (asset.getSize() != null
                && (asset.getSize() <= 0 || asset.getSize() > DEFAULT_MAX_REFERENCE_VIDEO_BYTES)) {
            throw new VideoInputError(GenerationError.ERROR_INVALID_REFERENCE_MEDIA,
                    "单个参考视频不能超过 200 MB");
        }

        // duration：下限 2s 是素材平台约束（能力行无字段）；上限读能力行
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

        // dimensions（validateReferenceVideoDimensions）
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

    /**
     * IKJ80P：异常链上是否存在「请求已发出后」的 {@link java.net.SocketTimeoutException}
     * （自环防死循环，JobFinalizer.isRowLockConflict 同款遍历）。submit 阶段命中 = 读超时
     * 放弃，但网关可能随后仍完成建单——孤儿疑似判定信号。
     * <p>
     * IKJ80I review 修复：OkHttp 的 connect 超时同样抛 SocketTimeoutException
     * （RealConnection.connectSocket 只包装 ConnectException，超时原样上抛），但请求根本
     * 未送达、网关不可能建单，不得标孤儿。按 JDK 原始 message 收窄（实证 okhttp 4.12.0 +
     * JDK 17，NioSocketImpl）：connect 超时 = "Connect timed out"（JDK 8 PlainSocketImpl
     * 为小写 "connect timed out"，忽略大小写覆盖两代）；read 超时 = "Read timed out"。
     * message 为 null / 未知形态保守视为非 connect（漏标真孤儿 = 已扣量追不回，代价大于
     * 误标进对账清单的噪音）。
     */
    private static boolean hasSocketTimeoutCause(Throwable error) {
        for (Throwable t = error; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof java.net.SocketTimeoutException && !isConnectTimeoutMessage(t.getMessage())) {
                return true;
            }
        }
        return false;
    }

    /** JDK connect 超时的原始 message 以 "connect" 开头（大小写跨 JDK 版本不一致，忽略之）。 */
    private static boolean isConnectTimeoutMessage(String message) {
        return message != null && message.toLowerCase().startsWith("connect");
    }

    // ========== videoDimensions / dimensionsFromSize ==========

    /**
     * 视频尺寸换算。此处即该逻辑的**唯一实现**：原 TS 版随 node worker 退役、
     * 且 IKG0FR 删掉提交期的那道校验后，TS 侧已无消费者，故一并删除。
     * <p>
     * resolution + aspect_ratio → width/height；或 size "WxH" → width/height。
     */
    static int[] resolveDimensions(Map<String, Object> input) {
        Map<String, Object> params = input.get("parameters") instanceof Map<?, ?> p
                ? castMap(p) : null;

        // videoDimensions
        Object resolutionObj = input.get("resolution");
        Object aspectRatioObj = input.get("aspect_ratio");
        if (resolutionObj instanceof String resolution && aspectRatioObj instanceof String aspectRatio) {
            int[] dims = videoDimensions(resolution, aspectRatio);
            if (dims != null) return dims;
        }

        // dimensionsFromSize
        Object sizeObj = params != null ? params.get("size") : input.get("size");
        if (sizeObj instanceof String size) {
            return dimensionsFromSize(size);
        }
        return null;
    }

    /** IKFPYX：编辑意图关键词。官方原文「编辑视频、增加/加上、删除/去掉、修改/替换/改成」——
     *  斜杠是同义项，展开即这 8 个词。**没有裸「编辑」**（官方那条是「编辑视频」两字连写）。
     *  两端逐字相同，理由见 backend `capability-param-validation.ts` 同名字段的注释。 */
    private static final List<String> EDIT_INTENT_KEYWORDS = List.of(
            "编辑视频", "增加", "加上", "删除", "去掉", "修改", "替换", "改成");

    /** IKFPYX：延长意图关键词。官方原文「向前/向后延长、延续、续写」——斜杠是方向二选一，
     *  展开即「向前延长」「向后延长」加「延续」「续写」。**没有裸「延长」，也没有裸「向前」「向后」**
     *  （后者会命中「镜头向前推进」这种运镜描述）。 */
    private static final List<String> PROLONG_INTENT_KEYWORDS = List.of(
            "向前延长", "向后延长", "延续", "续写");

    /** IKJ78C：否定防护词表（六词闭集，扩词走评审）。两端逐字相同，
     *  理由见 backend `capability-param-validation.ts` 同名字段的注释。 */
    private static final List<String> NEGATION_KEYWORDS = List.of(
            "禁止", "不得", "不要", "不能", "勿", "无需");

    /** IKJ78C：子句切分标点（中英闭集，规格口径），与 backend 同源。 */
    private static final String CLAUSE_SEPARATORS = "[，。；！？、,.;!?]";

    /** IKJ78C：否定防护后的关键词扫描——先按标点切子句，否定词与关键词落在同一子句时
     *  剔除该命中（含否定词的子句整体不参与扫描）；跨子句不剔除（混合句按肯定判）。 */
    private static boolean hasIntentKeyword(String prompt, List<String> words) {
        for (String clause : prompt.split(CLAUSE_SEPARATORS)) {
            if (NEGATION_KEYWORDS.stream().anyMatch(clause::contains)) continue;
            if (words.stream().anyMatch(clause::contains)) return true;
        }
        return false;
    }

    /** IKFPYX：判定视频任务类型（与 backend `contracts/capability-param-validation.ts`
     *  resolveVideoTaskType 同源口径，两端不得各自发明）。
     *  优先级：首尾帧角色 > 单帧角色 > 参考视频 + 提示词意图（延长先于编辑，后者词面更宽）> default。
     *  「必须至少有一个参考视频」是**官方明文**（API 文档 `omni_reference_task_type` 的 edit/extend 说明）。
     *  按模型分叉的约束（2.5 编辑/延长/首尾帧仅支持 adaptive；2.0 可指定）走能力行配置，不写在这里。 */
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
