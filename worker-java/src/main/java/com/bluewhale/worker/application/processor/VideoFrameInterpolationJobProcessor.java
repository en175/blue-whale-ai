package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.contract.VideoFrameInterpolationContract;
import com.bluewhale.worker.domain.dto.ClaimedVideoFrameInterpolationJobDto;
import com.bluewhale.worker.domain.dto.PublishVideoFrameInterpolationDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoFrameInterpolationError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitInterpolateVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitInterpolateVideoClient.InterpolateVideoTaskObservation;
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
 * video_frame_interpolation（视频插帧，火山 MediaKit video-frame-interpolation）作业处理器
 * （IKHLKJ，父需求 IKHLES，附录 C 触点③）。编排与 {@link VideoEnhanceJobProcessor} 同构
 * （视频轮询骨架，每步 = 一次 MQ 消费，fencing / 租约 / claim-by-id 全部走视频件）：
 * <ol>
 *   <li>claimVideoFrameInterpolation（富投影：providerTaskId / pollCount / progress / cancelRequested）</li>
 *   <li>providerTaskId==null → 解析冻结 input + 源视频素材 → 网关提交（video_url + 整型 fps
 *       原样透传）→ markProviderSubmitted（存 provider_task_id + 释放租约 + next+5s）→ scheduleNext(5s)</li>
 *   <li>providerTaskId!=null → 查询任务 → 瞬时错误与 processing 续排**共用同一轮询预算**
 *       （pollCount 上限 720，超限一律 1049 终态并停止续排，IKHSFI）；failed →
 *       分类终态；completed → **立即下载转存（火山 video_url
 *       仅 24h 有效）** → 建 Asset（type=video / source='generated'）→ 终态 succeeded</li>
 * </ol>
 * 下载与转存复用 {@link TosVideoMediaRelay}（视频家族同套：fetch → video/ mime 校验 →
 * TOS 公开读 → md5）；结果 URL 24h 失效故**强依赖 TOS，不降级直存**（对齐 HD / 去字幕口径）。
 * <p>
 * 结果元数据（官方 result 四键 video_url / duration / resolution / fps）：宽高**取源 Asset
 * 近似值**——官方明示「插帧不改变分辨率，跟随原片」，故不复制 HD 的档位短边推导、也不设输入
 * 门槛（规格「输入分辨率上下限官方未明确 → 不设门槛」）；时长优先官方精确值、缺失回落源
 * duration_ms 换算；输出 fps 优先官方 result.fps、缺失回落冻结 input fps——resolution / fps
 * 落终态日志 payload（assets 无对应列，**不新增卡片 / 资产 fps 元数据链**，ADR-0113）。
 * <p>
 * 心跳续租沿用视频骨架的「每步释放租约 + 自投延迟消息」：claim 时取 420s 租约，submit / poll
 * 每步以 CAS 守卫（status='processing' + lease_owner + fencing_token）写状态并**显式释放租约**、
 * 自投 5s 延迟消息驱动下一步——租约不跨步累积，长任务不会因单步超时被 recovery 判孤儿重投；
 * completed 步的下载 + 转存落在同一 420s 租约窗口内（大文件余量，见 JobClaimService 常量注释）。
 * <p>
 * 取消（后端软取消入口对本类型生效：置 cancel_requested_at，无按 type 白名单）：每一步 claim
 * 读到 cancelRequested 即落**确定终态 cancelled**——未提交上游走家族既有
 * {@code cancelVideoBeforeDispatch}；已提交上游时官方无取消端点（上游任务不可撤），走
 * {@code cancelVideoAfterDispatch}（本仓侧停止接纳结果）。取消与结果返回的竞态由 fencing /
 * 终态权威裁决：两种写都要求 status='processing' + 当前 lease_owner + 当前 fencing_token，
 * 先生效的终态获胜，**已取消任务的迟到结果过不了 publish 守卫，不会把任务或卡片复活为成功**。
 * <p>
 * 错误码口径（数值 1049，无 worker 级自动重试，用户手动重试沿用冻结 input）：
 * <ul>
 *   <li>provider_credential_missing：任务缺少冻结凭证（与视频 / HD 同构；凭证冻结在创建入口 IKHLK3）</li>
 *   <li>invalid_input：业务键缺失 / fps 三档枚举外（创建入口复核是权威，worker 兜底防御）</li>
 *   <li>content_rejected / content_rejected_reference / quota_exhausted：NewApiErrorClassifier
 *       §5 分类信号（网关错误与火山 failed 双路），保留既有码投影</li>
 *   <li>video_frame_interpolation_failed（1049）：其余一律归并兜底——网关 provider_failed /
 *       提交超时 / 轮询超时（**瞬时错误与 processing 续排耗尽同一 720 次预算即落终态，
 *       不再无限轮询**，IKHSFI）/ 火山任务 failed（**含入口未前置判定的官方门槛拒绝**：目标帧率
 *       实际落在 [15,120] 外、输入规格不符、文件大小或时长超上游限制）/ 源素材不可用 /
 *       结果下载转存失败（超时也归并是家族口径：宁可不重试也不双跑），上游可读原因随 message
 *       透传前端投影</li>
 * </ul>
 */
@Component
public class VideoFrameInterpolationJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(VideoFrameInterpolationJobProcessor.class);

    /** §5 分类信号白名单：这些既有码直接投影，其余全部归并 video_frame_interpolation_failed(1049)。 */
    private static final Set<String> PRESERVED_ERROR_CODES = Set.of(
            GenerationError.ERROR_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    /** 轮询步调 5s（HD / 去字幕 / 音视频分离同值）。 */
    public static final long VIDEO_FRAME_INTERPOLATION_POLL_INTERVAL_MS = 5_000;

    /** 轮询上限 720 次 ≈ 60 分钟（家族 MAX_*_POLLS 同值：60 分钟窗口，超限归并 1049）。 */
    public static final int MAX_VIDEO_FRAME_INTERPOLATION_POLLS = 720;

    private final JobStateMachineService stateMachine;
    private final AssetSourceService assetSource;
    private final GenerationCredentialService credentialService;
    private final NewApiMediaKitInterpolateVideoClient interpolateVideoClient;
    private final TosVideoMediaRelay mediaRelay;
    private final GenerationMessageProducer producer;
    private final String workerId;

    public VideoFrameInterpolationJobProcessor(
            JobStateMachineService stateMachine,
            AssetSourceService assetSource,
            GenerationCredentialService credentialService,
            NewApiMediaKitInterpolateVideoClient interpolateVideoClient,
            TosVideoMediaRelay mediaRelay,
            @Qualifier("videoFrameInterpolationMessageProducer")
            GenerationMessageProducer producer
    ) {
        this.stateMachine = stateMachine;
        this.assetSource = assetSource;
        this.credentialService = credentialService;
        this.interpolateVideoClient = interpolateVideoClient;
        this.mediaRelay = mediaRelay;
        this.producer = producer;
        this.workerId = "vfi-" + hostname() + "-" + ProcessHandle.current().pid();
    }

    @Override
    public String tag() {
        return VideoFrameInterpolationContract.TAG;
    }

    /**
     * 处理一个 video_frame_interpolation step。
     * <p>
     * claim 在 try 外（视频骨架同构：DB 异常上抛 → consumer 不 ack → 重投）；
     * 业务失败一律落终态 failed（无自动重试）。
     */
    @Override
    public void handle(String jobId) {
        Optional<ClaimedVideoFrameInterpolationJobDto> claimOpt;
        try {
            claimOpt = stateMachine.claimVideoFrameInterpolation(jobId, workerId);
        } catch (Exception error) {
            log.error("[video_frame_interpolation] claim 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error; // 保持不 ack → RocketMQ 重投
        }
        if (claimOpt.isEmpty()) return; // 无可认领 / 重复唤醒 / 已终态（含已取消）

        ClaimedVideoFrameInterpolationJobDto claim = claimOpt.get();
        log.info("[video_frame_interpolation] 已领取 jobId={} token={} providerTaskId={} pollCount={}",
                claim.id(), claim.fencingToken(), claim.providerTaskId(), claim.pollCount());

        try {
            runStep(claim);
        } catch (Exception e) {
            String code = resolveFailCode(e);
            String message = e.getMessage() != null ? e.getMessage() : "视频插帧失败";
            log.error("[video_frame_interpolation] 终态失败 jobId={} code={}: {}",
                    claim.id(), code, message, e);
            failClaimed(claim, code, message);
        }
    }

    /**
     * 分相主逻辑（HD 骨架 runStep 同构）：取消 → 凭证 → submit 相 / poll 相。
     */
    private void runStep(ClaimedVideoFrameInterpolationJobDto claim) {
        // 取消优先于一切（用户名下 queued/processing 任务的软取消对本类型生效）：落确定终态
        // cancelled，不再提交 / 轮询，也不再发布结果（迟到结果过不了终态守卫）。
        if (claim.cancelRequested()) {
            log.info("[video_frame_interpolation] 取消已执行 jobId={} providerTaskId={}",
                    claim.id(), claim.providerTaskId());
            stateMachine.cancelVideoFrameInterpolation(
                    claim.id(), claim.workerId(), claim.fencingToken(), claim.providerTaskId());
            return;
        }

        // 取明文凭证（基础设施键，per-job 冻结；与视频 / HD 同构，冻结在创建入口 IKHLK3）
        Object credentialObj = claim.input().get("provider_credential");
        if (!(credentialObj instanceof String providerCredential) || providerCredential.isEmpty()) {
            failClaimed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "视频插帧任务缺少供应商凭证");
            return;
        }
        String providerToken;
        try {
            providerToken = credentialService.open(providerCredential);
        } catch (Exception e) {
            log.debug("[video_frame_interpolation] 凭证无效 jobId={}: {}", claim.id(), e.getMessage(), e);
            failClaimed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "视频插帧任务凭证无效");
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
    private void submitPhase(ClaimedVideoFrameInterpolationJobDto claim, String providerToken) {
        // 0. IKI8A0（ADR-0114）：重试收割——retry job 先查父任务上游，命中则不重新提交
        if (claim.parentProviderTaskId() != null) {
            if (tryReuseParentResult(claim, providerToken)) {
                return;
            }
        }

        Map<String, Object> input = claim.input();

        // 1. 解析冻结 input 业务键（三键恒在、值恒为合法帧率；此处为 worker 兜底防御，
        //    权威复核在创建入口。target_node_id 是前端回填定位键，worker 不消费，不解析）。
        String sourceAssetId = parseAssetId(
                input.get(VideoFrameInterpolationContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId == null) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "缺少源视频资产 id");
            return;
        }
        Integer fps = parseFps(input.get(VideoFrameInterpolationContract.INPUT_KEY_FPS));
        if (fps == null) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "插帧目标帧率非法");
            return;
        }

        // 2. 解析源视频素材：Asset url 落库即公网 public-read，直接作 video_url（HD 同构）；
        //    插帧**不设输入门槛**（官方未明确输入分辨率上下限与文件大小 / 时长限制，规格「官方
        //    未明确不臆造」），越界交上游按官方限制拒，失败归任务口径。
        AssetEntity source = assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.user_id()),
                Long.parseLong(claim.project_id()));
        if (source == null || !"video".equals(source.getType())
                || source.getUrl() == null || source.getUrl().isEmpty()) {
            failClaimed(claim, VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED,
                    "源视频资产不可用");
            return;
        }

        // 3. 网关提交异步任务（出站仅 model + video_url + 整型 fps，见客户端 payload 注释）
        String taskId = interpolateVideoClient.submit(providerToken, source.getUrl(), fps);
        log.info("[video_frame_interpolation] 上游已提交 jobId={} providerTaskId={} fps={}",
                claim.id(), taskId, fps);

        // 4. markProviderSubmitted（视频骨架复用件：存 provider_task_id + 释放租约 + next+5s）
        boolean updated = stateMachine.markProviderSubmitted(
                claim.id(), claim.workerId(), claim.fencingToken(), taskId);
        if (updated) {
            scheduleNext(claim.id(), VIDEO_FRAME_INTERPOLATION_POLL_INTERVAL_MS);
        }
    }

    /**
     * IKI8A0（ADR-0114）：重试收割（parent-reuse，视频 IKEA26 先例推广）。
     * <p>
     * 超窗判失败后上游任务仍在跑；用户手动重试时先查父任务的上游任务：已成功且结果
     * URL 齐全 → 不重新提交，直接以父任务 observation 走既有 {@link #publishResult}
     * 发布（资产入库、源宽高近似、项目事件与正常完成同型，不新建 cost 记录）。
     * 父任务失败 / 不存在 / 查询异常 / 收割发布失败四种形态一律返回 false，
     * 回退 submit 相正常重新提交，无第三种行为分支。
     */
    private boolean tryReuseParentResult(ClaimedVideoFrameInterpolationJobDto claim, String providerToken) {
        InterpolateVideoTaskObservation observation;
        try {
            observation = interpolateVideoClient.poll(providerToken, claim.parentProviderTaskId());
        } catch (Exception error) {
            // 不存在与查询异常同路处理（视频先例 D6 同款：当不存在，重新 submit）
            log.warn("[video_frame_interpolation] 重试收割查父任务失败 jobId={} parentTask={} err={}，按不存在处理重新提交",
                    claim.id(), claim.parentProviderTaskId(), error.getMessage(), error);
            return false;
        }

        if (!"succeeded".equals(observation.status())) {
            log.info("[video_frame_interpolation] 重试收割未命中(父任务未成功) jobId={} parentTask={} status={}，回退重新提交",
                    claim.id(), claim.parentProviderTaskId(), observation.status());
            return false;
        }
        if (observation.videoUrl() == null || observation.videoUrl().isEmpty()) {
            log.info("[video_frame_interpolation] 重试收割未命中(父任务结果不齐全) jobId={} parentTask={}，回退重新提交",
                    claim.id(), claim.parentProviderTaskId());
            return false;
        }

        log.info("[video_frame_interpolation] 重试收割命中 jobId={} parentTask={}，复用旧结果发布（不重新提交）",
                claim.id(), claim.parentProviderTaskId());
        try {
            boolean published = publishResult(claim, observation);
            if (!published) {
                log.warn("[video_frame_interpolation] 重试收割发布未命中守卫 jobId={}（stale worker / 已终态 / 已取消），回退重新提交",
                        claim.id());
            }
            return published;
        } catch (Exception error) {
            // 结果取回/发布失败（如结果 URL 已超 24h 失效下载 404）→ 回退重新提交兜底
            log.warn("[video_frame_interpolation] 重试收割发布失败 jobId={} parentTask={} err={}，回退重新提交",
                    claim.id(), claim.parentProviderTaskId(), error.getMessage(), error);
            return false;
        }
    }

    // ========== poll 相 ==========

    /**
     * 轮询相：查询任务 → 瞬时错误续排 / processing 续排（两路**共用 pollCount 轮询预算**，
     * 超限一律 1049 终态并停止续排，IKHSFI）/ failed 终态 / completed 立即下载转存发布。
     */
    private void pollPhase(ClaimedVideoFrameInterpolationJobDto claim, String providerToken) {
        InterpolateVideoTaskObservation observation;
        try {
            observation = interpolateVideoClient.poll(providerToken, claim.providerTaskId());
        } catch (VideoFrameInterpolationError pollError) {
            if (isTransientPollError(pollError)) {
                // IKHSFI：瞬时错误续排与 processing 续排共用同一预算——pollCount 由
                // rescheduleProviderPoll 单点累计（两条路径同一条 SQL），claim 读到的即
                // 此前已续排次数；耗尽即落可读失败终态，不派发下一次轮询（防上游持续
                // 超时 / 连接失败 / 503 时无限轮询打爆网关与 MQ）。
                if (claim.pollCount() >= MAX_VIDEO_FRAME_INTERPOLATION_POLLS) {
                    String reason = pollError.getMessage() != null
                            ? pollError.getMessage() : "上游持续瞬时错误";
                    log.warn("[video_frame_interpolation] 轮询瞬时错误且预算耗尽 jobId={} pollCount={} err={}，落终态",
                            claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                    failPollBudgetExhausted(claim, "持续瞬时错误: " + reason);
                    return;
                }
                log.warn("[video_frame_interpolation] 轮询瞬时错误 jobId={} pollCount={} err={}，重排继续轮询",
                        claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                boolean updated = stateMachine.rescheduleProviderPoll(
                        claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
                if (updated) {
                    scheduleNext(claim.id(), VIDEO_FRAME_INTERPOLATION_POLL_INTERVAL_MS);
                }
                return;
            }
            throw pollError;
        }

        if ("processing".equals(observation.status())) {
            if (claim.pollCount() >= MAX_VIDEO_FRAME_INTERPOLATION_POLLS) {
                // 轮询超时归并兜底码（家族口径：宁可不重试也不双跑；用户手动重试会重新提交）
                failPollBudgetExhausted(claim, "");
                return;
            }
            boolean updated = stateMachine.rescheduleProviderPoll(
                    claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
            if (updated) {
                scheduleNext(claim.id(), VIDEO_FRAME_INTERPOLATION_POLL_INTERVAL_MS);
            }
            return;
        }

        if ("failed".equals(observation.status())) {
            // 上游可读原因透传（目标帧率越界 / 输入规格不符 / 文件大小或时长超限等官方门槛拒绝走这里）；
            // 额度 / 内容政策信号按 §5 保留既有码（HD / 去字幕同款分类链）
            String message = observation.upstreamMessage() != null && !observation.upstreamMessage().isEmpty()
                    ? observation.upstreamMessage() : "视频插帧任务失败";
            String code = classifyUpstreamFailure(observation.upstreamCode(), observation.upstreamMessage());
            log.info("[video_frame_interpolation] 上游状态终态=failed jobId={} providerTaskId={} code={} pollCount={}",
                    claim.id(), claim.providerTaskId(), code, claim.pollCount());
            failClaimed(claim, code, message);
            return;
        }

        // completed（succeeded）
        log.info("[video_frame_interpolation] 上游状态终态=completed jobId={} providerTaskId={} pollCount={}",
                claim.id(), claim.providerTaskId(), claim.pollCount());
        if (observation.videoUrl() == null || observation.videoUrl().isEmpty()) {
            failClaimed(claim, VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED,
                    "插帧任务成功但未返回结果视频");
            return;
        }
        publishResult(claim, observation);
    }

    /**
     * 结果发布：立即下载转存（火山 video_url 仅 24h 有效，官方明确「须及时下载保存」）→
     * 建 Asset（type=video / source='generated' / generation_job_id）→ 终态 succeeded。
     * <p>
     * 返回发布守卫结果（IKI8A0：重试收割据此判定复用是否成立，false 回退正常重新提交）。
     */
    private boolean publishResult(ClaimedVideoFrameInterpolationJobDto claim,
                                  InterpolateVideoTaskObservation observation) {
        // TOS 强依赖：结果 URL 24h 失效，不允许降级直存（对齐 HD / 去字幕的强依赖口径）
        if (mediaRelay == null) {
            throw new VideoFrameInterpolationError(
                    VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED,
                    "视频插帧转存存储未配置");
        }
        TosVideoMediaRelay.StoredVideo stored =
                mediaRelay.persist(observation.videoUrl(), claim.user_id());
        log.info("[video_frame_interpolation] 转存完成 jobId={} storageKey={} size={}",
                claim.id(), stored.storageKey(), stored.size());

        // 官方明示「插帧不改变分辨率，跟随原片」→ 宽高取源 Asset 近似值（官方不返回输出像素，
        // 也不做档位推导；源宽高缺失 → null，§8 静默容忍）
        AssetEntity source = resolveSource(claim);
        Integer width = source != null ? source.getWidth() : null;
        Integer height = source != null ? source.getHeight() : null;

        // 时长优先官方 result.duration 精确值，缺失回落源 duration_ms 换算（HD / 去字幕同构）
        Double sourceDurationSec = null;
        if (source != null && source.getDurationMs() != null) {
            sourceDurationSec = source.getDurationMs() / 1000.0;
        }
        Double durationSec = observation.durationSec() != null
                ? observation.durationSec() : sourceDurationSec;

        // 输出帧率：官方 result.fps 与提交时目标帧率一致；缺失回落冻结 input fps
        // （只作结果契约字段随终态日志 payload 承载，不落库不上卡）
        Double fps = observation.fps() != null ? observation.fps() : frozenFps(claim);

        boolean published = stateMachine.publishVideoFrameInterpolationResult(
                new PublishVideoFrameInterpolationDto(
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
                        durationSec,
                        observation.resolution(),
                        fps));
        if (published) {
            log.info("[video_frame_interpolation] 发布成功 jobId={}", claim.id());
        } else {
            log.warn("[video_frame_interpolation] 终态失败(发布守卫未命中) jobId={}（stale worker / 已终态 / 已取消）",
                    claim.id());
        }
        return published;
    }

    // ========== 瞬时轮询错误判定（视频骨架 isTransientPollError 同语义） ==========

    /**
     * 瞬时轮询错误判定（HD isTransientPollError 同语义）：网络超时 / 不可达 → 瞬时；
     * HTTP 429/5xx（cause 携带状态）→ 瞬时；4xx 与业务失败 → 非瞬时。
     */
    static boolean isTransientPollError(VideoFrameInterpolationError error) {
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

    /** Asset id 容忍数字形态（Jackson 数字 JSON 值），与 HD / 去字幕解析同构。 */
    private static String parseAssetId(Object obj) {
        if (obj instanceof String s && !s.isEmpty()) return s;
        if (obj instanceof Number n) return String.valueOf(n.longValue());
        return null;
    }

    /**
     * 解析冻结 input 的目标帧率（**整型**）：只接受整数形态的 JSON 数字（契约「整型直传」
     * ——字符串 "60" 与小数 60.5 在创建入口 zod 已被拒，此处同样拒，兜底防御不放松口径），
     * 且必须落在契约三档（30 / 60 / 120）内。
     */
    static Integer parseFps(Object obj) {
        if (!(obj instanceof Number n)) return null;
        double d = n.doubleValue();
        if (Double.isInfinite(d) || Double.isNaN(d) || d != Math.floor(d)) return null;
        int value = (int) d;
        return VideoFrameInterpolationContract.SUPPORTED_FPS.contains(value) ? value : null;
    }

    /** 冻结 input 的目标帧率（发布期回落用：解析失败返回 null，静默容忍）。 */
    private static Double frozenFps(ClaimedVideoFrameInterpolationJobDto claim) {
        Integer fps = parseFps(claim.input().get(VideoFrameInterpolationContract.INPUT_KEY_FPS));
        return fps != null ? fps.doubleValue() : null;
    }

    /** 解析源 Asset（宽高取近似值、时长供回落；归属三元组与提交相同构）。 */
    private AssetEntity resolveSource(ClaimedVideoFrameInterpolationJobDto claim) {
        String sourceAssetId = parseAssetId(
                claim.input().get(VideoFrameInterpolationContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId == null) return null;
        return assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.user_id()),
                Long.parseLong(claim.project_id()));
    }

    /**
     * 失败码归一：§5 分类信号（额度 / 内容政策）保留既有码，其余一律归并兜底
     * video_frame_interpolation_failed（1049）。
     */
    private static String resolveFailCode(Exception e) {
        if (e instanceof VideoFrameInterpolationError vfie
                && PRESERVED_ERROR_CODES.contains(vfie.getCode())) {
            return vfie.getCode();
        }
        return VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED;
    }

    /**
     * 上游任务 failed 的错误码分类（§5 优先级；HD / 去字幕分类链同款：
     * 版权 → 内容政策 → 额度 → 兜底 1049）。
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
        return VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED;
    }

    /** 轮询预算耗尽的统一终态落点（IKHSFI）：瞬时错误续排与 processing 续排两路共用，
     *  一律归并兜底 1049 并停止续排（不 reschedule / 不 enqueue）。detail 为空串时即
     *  processing 超限原文案；非空时追加瞬时错误原因（上游可读，随 message 透传投影）。 */
    private void failPollBudgetExhausted(ClaimedVideoFrameInterpolationJobDto claim, String detail) {
        failClaimed(claim, VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED,
                "视频插帧轮询超时（超过 " + MAX_VIDEO_FRAME_INTERPOLATION_POLLS + " 次" + detail + "）");
    }

    /** 失败处理：走视频版 failVideoJob（轮询型任务守卫多清 next_poll_at；插帧无输出槽位，
     *  槽位段天然空转；details.raw 透传原始原因）。守卫要求 status='processing'，故已取消 /
     *  已终态任务的失败写入同样不会生效（终态权威）。 */
    private void failClaimed(ClaimedVideoFrameInterpolationJobDto claim, String code, String msg) {
        log.warn("video_frame_interpolation job 失败 jobId={} code={} message={}", claim.id(), code, msg);
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
            log.error("[video_frame_interpolation] scheduleNext MQ 发送失败 jobId={} delayMs={}: {}",
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
