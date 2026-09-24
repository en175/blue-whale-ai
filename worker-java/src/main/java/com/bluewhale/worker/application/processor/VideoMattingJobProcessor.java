package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedVideoMattingJobDto;
import com.bluewhale.worker.domain.dto.PublishVideoMattingDto;
import com.bluewhale.worker.domain.dto.UpdateVideoMattingProgressDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.VideoMattingContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoMattingError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMatteVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMatteVideoClient.MatteVideoTaskObservation;
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
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * video_matting（智能抠像，火山 MediaKit 双端点人像/绿幕抠像）作业处理器（IKHK99，父规格
 * IKHJRC，契约 IKHK7F，附录 C 触点③）。编排与去字幕 / HD 高清 / 场景切分同构（视频轮询
 * 骨架，每步 = 一次 MQ 消费，fencing / 租约 / claim-by-id 全部走视频件）：
 * <ol>
 *   <li>claimVideoMatting（富投影：providerTaskId / pollCount / progress）</li>
 *   <li>providerTaskId==null → 解析冻结 input（mode / format / background_color）+ 源视频
 *       素材 → 网关按模式分流提交（portrait → matte-portrait-video、greenscreen →
 *       matte-greenscreen-video，路径与模型名走契约常量；出站 model / video_url / format /
 *       background_color〔仅 MP4 显式携带——两端点官方默认底色不同，本仓冻结 white 防歧义〕，
 *       不发 client_token / callback_* / queue_id / media_output_destination——家族轮询口径 +
 *       worker 转存自家 TOS，ADR-0112），返 task_id）→ markProviderSubmitted（存
 *       provider_task_id + 释放租约 + next+5s）→ scheduleNext(5s)</li>
 *   <li>providerTaskId!=null → 查询任务（两工具共用 tasks 查询）→ 瞬时错误
 *       rescheduleProviderPoll 续排（**同样受轮询上限约束**，超限归 1050——上游持续故障
 *       不得无限续排）；processing → 续排（超限 1050）；failed → 分类终态；
 *       completed → **转存前续租 + 转存全程心跳续租 60s（IKHSFD，防大文件下载+上传跨
 *       420s 租约窗被 recovery 孤儿重领；心跳未命中即中止传输静默退出）→ 立即下载
 *       转存自家 TOS（火山 video_url 仅 24h 有效）** → 建 Asset（type=video /
 *       source='generated'）→ 契约 result 三键回传 → 终态 succeeded</li>
 * </ol>
 * 重试收割（IKI89Z / ADR-0114，视频 IKEA26 先例推广、IKI89P 定型形态平移）：手动重试
 * job（claim 投影带 parentProviderTaskId）submit 相先查父任务的上游任务——已成功且结果
 * 齐全（videoUrl+resolution 双非空，对齐轮询相成功口径）则不重新提交，直接以父任务
 * observation 走既有 publishResult 发布（转存期租约心跳一并继承，收割期间租约由本
 * worker 心跳续）；父失败 / 不存在 / 查询异常 / 仍持有执行权的收割发布失败回退正常
 * 重新提交，收割发布期间失租或守卫未命中则停止本次执行不回退提交（IKICD0）。
 * <p>
 * 下载与转存复用 {@link TosVideoMediaRelay}（同套校验：fetch → video/ mime 校验 → TOS
 * 公开读 → md5），但走**流式** {@code persistStreaming} 并带本工具上限（审查修复 P2：
 * 家族字节数组路径 200MB 上限与堆绑死，本工具 10 分钟档成品可超）；结果 URL 24h 失效故
 * **强依赖 TOS，不降级直存**（去字幕家族口径）。
 * 转存失败 = 整体失败（归并 1050）：无 Asset 行落库、不留半成品资产悬挂，已上传的 TOS
 * 孤儿对象与家族先例同口径（无 Asset 引用即无悬挂）。
 * <p>
 * 结果元数据：抠像不改变分辨率 → 宽高取源 Asset 近似值（官方不返回输出像素；源宽高缺失
 * → null 静默容忍，去字幕同款口径）；时长优先官方 result.duration 精确值、缺失回落源
 * duration_ms 换算；resolution 档位官方 result.resolution 同名同值透传，与转存后
 * video_url、duration 一并按契约 RESULT_KEY_* 三键进终态日志 payload 与 status_changed
 * 事件 payload 的 result 键跨进程回传（双通道承载，video_scene_split 同款；video_url
 * 语义 = 转存自有存储后的公开读地址，官方 24h 临时链接不跨进程落库）。completed 未返回
 * 结果视频或分辨率档位 → 1050 兜底失败（转存前判定，无 TOS 孤儿）。
 * <p>
 * 错误码口径（契约：数值 1050，双模式共享一码、错误信息透传区分，无 worker 级自动重试，
 * 用户在任务占位卡手动重试沿用冻结 input）：
 * <ul>
 *   <li>provider_credential_missing：任务缺少冻结凭证（与视频/去字幕同构）</li>
 *   <li>invalid_input：业务键缺失 / 模式或格式枚举外 / MP4 缺背景色 / WEBM 带背景色
 *       （创建入口复核是权威，worker 兜底防御）</li>
 *   <li>content_rejected / content_rejected_reference / quota_exhausted：NewApiErrorClassifier
 *       §5 分类信号，保留既有码投影</li>
 *   <li>video_matting_failed（1050）：其余一律归并兜底——提交失败 / 轮询超时 / 供应商任务
 *       failed（error 对象 code / message / param / type——TaskError / ApiError）/ 源素材
 *       不可用 / 结果形态缺失 / 下载转存失败（超时也归并是家族口径：宁可不重试也不双跑），
 *       上游可读原因随 message 透传前端投影</li>
 * </ul>
 */
@Component
public class VideoMattingJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(VideoMattingJobProcessor.class);

    /** §5 分类信号白名单：这些既有码直接投影，其余全部归并 video_matting_failed(1050)。 */
    private static final Set<String> PRESERVED_ERROR_CODES = Set.of(
            GenerationError.ERROR_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    /** 轮询步调 5s（去字幕 / HD / 场景切分家族同值）。 */
    public static final long VIDEO_MATTING_POLL_INTERVAL_MS = 5_000;

    /**
     * 轮询上限 720 次 ≈ 60 分钟（家族 MAX_*_POLLS 同值）：官方处理耗时为视频时长 1~3 倍，
     * 创建入口 10 分钟时长门槛（ADR-0112，对齐去字幕）保证最长 30 分钟处理落在 60 分钟
     * 轮询窗口安全区内；查询接口在结果临期 2 小时内自动续期，轮询天然保活。
     */
    public static final int MAX_VIDEO_MATTING_POLLS = 720;

    /**
     * 结果转存期租约心跳周期 60s（IKHSFD）：claim 租约 420s 的 1/7——下载整段兜底 10 分钟 +
     * TOS 上传全程持续续租，合法的长时间转存不被 recovery 当孤儿重复领取；心跳未命中（已被
     * 接管/终态）即经 {@link TosVideoMediaRelay.TransferAbortHandle} 中止传输、本 worker 静默退出。
     */
    static final long RESULT_TRANSFER_LEASE_RENEW_INTERVAL_MS = 60_000;

    /** 心跳定时器（daemon 单线程，进程级共享）：只承载转存期周期续租，无状态轮询。 */
    private static final ScheduledExecutorService LEASE_HEARTBEAT_SCHEDULER =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "vmatt-lease-heartbeat");
                t.setDaemon(true);
                return t;
            });

    private final JobStateMachineService stateMachine;
    private final AssetSourceService assetSource;
    private final GenerationCredentialService credentialService;
    private final NewApiMediaKitMatteVideoClient matteVideoClient;
    private final TosVideoMediaRelay mediaRelay;
    private final GenerationMessageProducer producer;
    private final String workerId;

    /** 心跳周期（包私有可覆写：测试注入亚秒级周期做确定性长传输回归，不真等 60s）。 */
    long leaseRenewIntervalMs = RESULT_TRANSFER_LEASE_RENEW_INTERVAL_MS;

    public VideoMattingJobProcessor(
            JobStateMachineService stateMachine,
            AssetSourceService assetSource,
            GenerationCredentialService credentialService,
            NewApiMediaKitMatteVideoClient matteVideoClient,
            TosVideoMediaRelay mediaRelay,
            @Qualifier("videoMattingMessageProducer")
            GenerationMessageProducer producer
    ) {
        this.stateMachine = stateMachine;
        this.assetSource = assetSource;
        this.credentialService = credentialService;
        this.matteVideoClient = matteVideoClient;
        this.mediaRelay = mediaRelay;
        this.producer = producer;
        this.workerId = "vmatt-" + hostname() + "-" + ProcessHandle.current().pid();
    }

    @Override
    public String tag() {
        return VideoMattingContract.TAG;
    }

    /**
     * 处理一个 video_matting step。
     * <p>
     * claim 在 try 外（视频骨架同构：DB 异常上抛 → consumer 不 ack → 重投）；
     * 业务失败一律落终态 failed（无自动重试）。
     */
    @Override
    public void handle(String jobId) {
        Optional<ClaimedVideoMattingJobDto> claimOpt;
        try {
            claimOpt = stateMachine.claimVideoMatting(jobId, workerId);
        } catch (Exception error) {
            log.error("[video_matting] claim 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error; // 保持不 ack → RocketMQ 重投
        }
        if (claimOpt.isEmpty()) return; // 无可认领 / 重复唤醒

        ClaimedVideoMattingJobDto claim = claimOpt.get();
        log.info("[video_matting] 已领取 jobId={} token={} providerTaskId={} pollCount={}",
                claim.id(), claim.fencingToken(), claim.providerTaskId(), claim.pollCount());

        try {
            runStep(claim);
        } catch (Exception e) {
            String code = resolveFailCode(e);
            String message = e.getMessage() != null ? e.getMessage() : "智能抠像失败";
            log.error("[video_matting] 终态失败 jobId={} code={}: {}", claim.id(), code, message, e);
            failClaimed(claim, code, message);
        }
    }

    /**
     * 分相主逻辑（视频骨架 runVideoStep 同构）：凭证 → submit 相 / poll 相。
     */
    private void runStep(ClaimedVideoMattingJobDto claim) {
        // 取明文凭证（基础设施键；与视频/去字幕同构，冻结在创建入口 IKHK98）
        Object credentialObj = claim.input().get("provider_credential");
        if (!(credentialObj instanceof String providerCredential) || providerCredential.isEmpty()) {
            failClaimed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "智能抠像任务缺少供应商凭证");
            return;
        }
        String providerToken;
        try {
            providerToken = credentialService.open(providerCredential);
        } catch (Exception e) {
            log.debug("[video_matting] 凭证无效 jobId={}: {}", claim.id(), e.getMessage(), e);
            failClaimed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "智能抠像任务凭证无效");
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
     * 提交相：解析冻结 input + 源视频 → 网关按模式分流提交 → markProviderSubmitted → 续排轮询。
     */
    private void submitPhase(ClaimedVideoMattingJobDto claim, String providerToken) {
        // 0. IKI89Z（ADR-0114）：重试收割——retry job 先查父任务上游，终局（已发布或
        //    失租/守卫未命中停止执行，IKICD0）则不重新提交
        //    （IKI8GN：骨架收敛至 ParentResultReuse，家族差异=齐全判定/发布入口以参数表达）
        if (claim.parentProviderTaskId() != null) {
            if (ParentResultReuse.tryReuseParentResult(VideoMattingContract.TAG, claim, providerToken,
                    matteVideoClient::poll,
                    this::mattingResultIncomplete,
                    this::publishResult)) {
                return;
            }
        }

        Map<String, Object> input = claim.input();

        // 1. 解析冻结 input 业务键（创建时定死〔创建入口补默认后冻结〕；此处为 worker 兜底
        //    防御，权威复核在创建入口。target_node_id 是前端回填定位键，worker 不消费，不解析。
        String sourceAssetId = parseAssetId(input.get(VideoMattingContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId == null) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "缺少源视频资产 id");
            return;
        }
        Object modeObj = input.get(VideoMattingContract.INPUT_KEY_MODE);
        if (!(modeObj instanceof String mode)
                || !VideoMattingContract.SUPPORTED_MODES.contains(mode)) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "抠像模式非法");
            return;
        }
        Object formatObj = input.get(VideoMattingContract.INPUT_KEY_FORMAT);
        if (!(formatObj instanceof String format)
                || !VideoMattingContract.SUPPORTED_FORMATS.contains(format)) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "抠像输出格式非法");
            return;
        }
        Object backgroundColorObj = input.get(VideoMattingContract.INPUT_KEY_BACKGROUND_COLOR);
        String backgroundColor = backgroundColorObj instanceof String backgroundValue
                ? backgroundValue : null;
        if ("MP4".equals(format)) {
            // MP4 必带合法背景色（创建入口补缺省 white 后冻结，契约 refine 同款）
            if (backgroundColor == null
                    || !VideoMattingContract.SUPPORTED_BACKGROUND_COLORS.contains(backgroundColor)) {
                failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "MP4 背景色非法或缺失");
                return;
            }
        } else if (backgroundColorObj != null) {
            // WEBM 透明不接受背景色（契约 refine 同款），兜底拒绝历史脏值
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT,
                    "WEBM 透明输出不接受 background_color");
            return;
        }

        // 2. 解析源视频素材：Asset url 落库即公网 public-read，直接作 video_url（去字幕同构）；
        //    时长门槛（10 分钟置灰）在创建入口复核，worker 不重复——缺权威值不臆造，交供应商拒。
        AssetEntity source = assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.user_id()),
                Long.parseLong(claim.project_id()));
        if (source == null || !"video".equals(source.getType())
                || source.getUrl() == null || source.getUrl().isEmpty()) {
            failClaimed(claim, VideoMattingContract.ERROR_VIDEO_MATTING_FAILED,
                    "源视频素材不可用");
            return;
        }

        // 3. 网关按模式分流提交（端点与模型名映射在客户端经契约常量单处定义；MP4 才带
        //    background_color——出站形状在客户端测试钉）
        if (claim.parentProviderTaskId() != null && !stateMachine.reserveParentReuseSubmit(
                claim.id(), claim.workerId(), claim.fencingToken())) {
            log.warn("[video_matting] 重试收割回退提交前失租或续租状态无法确认，停止本次执行 jobId={}", claim.id());
            return;
        }
        String taskId = matteVideoClient.submit(
                providerToken, source.getUrl(), mode, format,
                "MP4".equals(format) ? backgroundColor : null);
        log.info("[video_matting] 上游已提交 jobId={} providerTaskId={} mode={} format={} backgroundColor={}",
                claim.id(), taskId, mode, format, "MP4".equals(format) ? backgroundColor : null);

        // 4. markProviderSubmitted（视频骨架复用件：存 provider_task_id + 释放租约 + next+5s；
        //    SQL 无 type 过滤，video_matting 直接复用）
        boolean updated = stateMachine.markProviderSubmitted(
                claim.id(), claim.workerId(), claim.fencingToken(), taskId);
        if (updated) {
            scheduleNext(claim.id(), VIDEO_MATTING_POLL_INTERVAL_MS);
        }
    }

    /**
     * 收割齐全判定（IKI8GN 家族差异参数）：videoUrl 与 resolution 双非空，对齐轮询相
     * completed 成功判据（不新立标准）。返回 null=齐全；非空=未齐原因短句（嵌进共享骨架
     * 「未命中(父任务{})」日志）。
     */
    private String mattingResultIncomplete(ClaimedVideoMattingJobDto claim,
                                           MatteVideoTaskObservation observation) {
        if (observation.videoUrl() == null || observation.videoUrl().isEmpty()) {
            return "结果视频缺失";
        }
        if (observation.resolution() == null || observation.resolution().isEmpty()) {
            return "缺分辨率档位";
        }
        return null;
    }

    // ========== poll 相 ==========

    /**
     * 轮询相：查询任务 → 瞬时错误续排 / processing 续排（含超限）/ failed 终态 /
     * completed 立即下载转存发布。
     */
    private void pollPhase(ClaimedVideoMattingJobDto claim, String providerToken) {
        MatteVideoTaskObservation observation;
        try {
            observation = matteVideoClient.poll(providerToken, claim.providerTaskId());
        } catch (VideoMattingError pollError) {
            if (isTransientPollError(pollError)) {
                // 轮询上限对瞬时错误同样生效（审查修复 P1）：上游持续故障（超时 / 429 / 5xx）
                // 时每次瞬时错误都走续排，若此处不判上限，poll_count 涨到 720 也进不了失败
                // 终态——卡片永远停在生成中。与 processing 分支同一判定、同一兜底码。
                if (claim.pollCount() >= MAX_VIDEO_MATTING_POLLS) {
                    log.warn("[video_matting] 轮询瞬时错误且已达轮询上限 jobId={} pollCount={} err={}，归失败终态",
                            claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                    failClaimed(claim, VideoMattingContract.ERROR_VIDEO_MATTING_FAILED,
                            "智能抠像轮询超时（超过 " + MAX_VIDEO_MATTING_POLLS + " 次）");
                    return;
                }
                log.warn("[video_matting] 轮询瞬时错误 jobId={} pollCount={} err={}，重排继续轮询",
                        claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                boolean updated = stateMachine.rescheduleProviderPoll(
                        claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
                if (updated) {
                    scheduleNext(claim.id(), VIDEO_MATTING_POLL_INTERVAL_MS);
                }
                return;
            }
            throw pollError;
        }

        if ("processing".equals(observation.status())) {
            if (claim.pollCount() >= MAX_VIDEO_MATTING_POLLS) {
                // 轮询超时归并兜底码（家族口径：宁可不重试也不双跑；用户手动重试会重新提交）
                failClaimed(claim, VideoMattingContract.ERROR_VIDEO_MATTING_FAILED,
                        "智能抠像轮询超时（超过 " + MAX_VIDEO_MATTING_POLLS + " 次）");
                return;
            }
            boolean updated = stateMachine.rescheduleProviderPoll(
                    claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
            if (updated) {
                scheduleNext(claim.id(), VIDEO_MATTING_POLL_INTERVAL_MS);
            }
            return;
        }

        if ("failed".equals(observation.status())) {
            // 上游可读原因透传；额度/内容政策信号按 §5 保留既有码（去字幕分类链同款：
            // 版权 → 内容政策 → 额度 → 兜底 1050）
            String message = observation.upstreamMessage() != null && !observation.upstreamMessage().isEmpty()
                    ? observation.upstreamMessage() : "智能抠像任务失败";
            String code = classifyUpstreamFailure(observation.upstreamCode(), observation.upstreamMessage());
            log.info("[video_matting] 上游状态终态=failed jobId={} providerTaskId={} code={} pollCount={}",
                    claim.id(), claim.providerTaskId(), code, claim.pollCount());
            failClaimed(claim, code, message);
            return;
        }

        // completed（succeeded）
        log.info("[video_matting] 上游状态终态=completed jobId={} providerTaskId={} pollCount={} resolution={} duration={}",
                claim.id(), claim.providerTaskId(), claim.pollCount(),
                observation.resolution(), observation.durationSec());
        if (observation.videoUrl() == null || observation.videoUrl().isEmpty()) {
            failClaimed(claim, VideoMattingContract.ERROR_VIDEO_MATTING_FAILED,
                    "智能抠像任务成功但未返回结果视频");
            return;
        }
        if (observation.resolution() == null || observation.resolution().isEmpty()) {
            // 契约 result.resolution 必填（TS videoMattingResultSchema z.string().min(1)）——
            // 缺失即异常形态，转存前落兜底失败（不产半成品资产，也无 TOS 孤儿）
            failClaimed(claim, VideoMattingContract.ERROR_VIDEO_MATTING_FAILED,
                    "智能抠像任务成功但未返回分辨率档位");
            return;
        }
        publishResult(claim, observation);
    }

    /**
     * 结果发布：转存前心跳续租（单产物大文件下载+TOS 上传可超 claim 的 420s 租约，场景切分
     * 逐段续租先例的单产物形态；续租未命中即中止——任务已被新 worker 接管或已终态，本
     * worker 静默退出）→ 立即下载转存（火山 video_url 仅 24h 有效，官方明确「请及时下载
     * 保存」；下载失败 = 整体失败，无 Asset 行落库不留半成品资产悬挂——异常上抛由 handle
     * 归并 1050）→ 单事务建 Asset（type=video / source='generated'）+ 契约 result 三键
     * （video_url=转存后地址 / resolution / duration）回传 → 终态 succeeded。
     * <p>
     * 返回发布终局语义（IKI89Z / IKICD0：重试收割据此判定复用是否成立）：true = 发布
     * 成功或租约丢失静默退出（已被接管/已终态，收割方不得回退重新提交——回退只会白付
     * 一次上游费用）；false = 发布守卫未命中（stale worker 或已终态，收割方同样停止
     * 本次执行不回退提交，与本家族心跳失租路径同一停止语义）；下载/转存失败经异常上抛，
     * 由收割方 catch 后回退（此时仍持有执行权）。
     */
    private boolean publishResult(ClaimedVideoMattingJobDto claim,
                                  MatteVideoTaskObservation observation) {
        // TOS 强依赖：结果 URL 24h 失效，不允许降级直存（去字幕家族口径）
        if (mediaRelay == null) {
            throw new VideoMattingError(
                    VideoMattingContract.ERROR_VIDEO_MATTING_FAILED,
                    "智能抠像转存存储未配置");
        }

        // 转存前心跳续租（progress 沿用 claim 快照——单产物无段扇出，转存期间无可上报的
        // 新进度，续租是主目的，进度不倒退；终态 100 由 publish 置）
        if (!renewLeaseForResultTransfer(claim)) {
            // 租约已失（已被接管/已终态）：静默终局（IKI89Z 收割语义——不回退重新提交）
            return true;
        }

        // 官方不返回输出像素 → 宽高取源近似（抠像不改变分辨率）；时长优先官方
        // result.duration，缺失回落源 duration_ms 换算（源宽高缺失 → null 静默容忍）
        Integer width = null;
        Integer height = null;
        Double sourceDurationSec = null;
        String sourceAssetId = parseAssetId(
                claim.input().get(VideoMattingContract.INPUT_KEY_SOURCE_ASSET_ID));
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

        TosVideoMediaRelay.StoredVideo stored;
        // 转存全程心跳续租（IKHSFD）：下载 + 上传可远超单次 420s 租约窗，心跳保持所有权；
        // 未命中（已被接管/终态/DB 异常）即经中止句柄停下传输——旧 worker 不发布资产、
        // 不覆盖终态，新 worker / recovery 兜底。首次续租已在上方完成，心跳首跳即一个周期后。
        TosVideoMediaRelay.TransferAbortHandle abortHandle = new TosVideoMediaRelay.TransferAbortHandle();
        ScheduledFuture<?> heartbeat = LEASE_HEARTBEAT_SCHEDULER.scheduleAtFixedRate(
                () -> {
                    if (!renewLeaseForResultTransfer(claim)) {
                        abortHandle.abort("结果转存期租约未命中（已被接管/终态）");
                    }
                },
                leaseRenewIntervalMs, leaseRenewIntervalMs, TimeUnit.MILLISECONDS);
        try {
            // 流式 + 本工具上限（审查修复 P2）：家族字节数组路径的 200MB 上限与堆绑死，而本工具
            // 源素材上限就是 200MB、成品为 10 分钟档重编码（WEBM 带 alpha 可更大）——走
            // persistStreaming（下载落临时文件、上传流式读），上限按契约 MAX_RESULT_BYTES
            stored = mediaRelay.persistStreaming(observation.videoUrl(), claim.user_id(),
                    VideoMattingContract.MAX_RESULT_BYTES, abortHandle);
        } catch (TosVideoMediaRelay.TransferAbortedException e) {
            // 外部信号中止（租约已失）≠ 任务失败：本 worker 静默退出，不落失败终态——
            // failVideoJob 的旧 fencing token 会被守卫拒绝，任务由新 worker / recovery 继续。
            // 收割语境同义：租约丢失是终局，返回 true 不回退重新提交（防白付上游费用）
            log.warn("[video_matting] 结果转存被中止，本 worker 静默退出 jobId={}: {}", claim.id(), e.getMessage());
            return true;
        } catch (Exception e) {
            // parentProviderTaskId 非空对重试任务全生命周期为真（含回退自提交后的轮询相）：
            // 轮询相自身结果转存失败叠加续租不明也走静默退出属有意行为——等 recovery 接手
            // 比写失败终态更稳（失败终态会丢弃重试链路，静默退出留给新 Worker / recovery 判定）
            if (claim.parentProviderTaskId() != null) {
                boolean leaseConfirmed = !abortHandle.aborted() && renewLeaseForResultTransfer(claim);
                if (!leaseConfirmed || abortHandle.aborted()) {
                    log.warn("[video_matting] 结果转存异常后执行权无法确认，停止本次执行 jobId={}", claim.id());
                    return true;
                }
            }
            // 下载/转存失败 → 整体失败（契约口径）：上抛由 handle 归并兜底码；无 Asset 行
            // 落库，不留半成品资产悬挂（TOS 孤儿对象与家族先例同口径）
            VideoMattingError transferFailure = new VideoMattingError(
                    VideoMattingContract.ERROR_VIDEO_MATTING_FAILED,
                    "抠像结果视频下载转存失败: " + e.getMessage());
            transferFailure.initCause(e);
            throw transferFailure;
        } finally {
            // 成功、失败、中止都停心跳，释放定时资源
            heartbeat.cancel(false);
        }
        if (abortHandle.aborted()) return true; // 传输返回前刚失租：同中止语义，静默终局
        log.info("[video_matting] 转存完成 jobId={} storageKey={} size={} resolution={}",
                claim.id(), stored.storageKey(), stored.size(), observation.resolution());

        boolean published = stateMachine.publishVideoMattingResult(new PublishVideoMattingDto(
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
                observation.resolution()));
        if (published) {
            log.info("[video_matting] 发布成功 jobId={}", claim.id());
        } else {
            log.warn("[video_matting] 终态失败(发布守卫未命中) jobId={}（stale worker 或已终态）",
                    claim.id());
        }
        return published;
    }

    /**
     * 结果转存期续租（转存前一次 + 全程心跳每跳复用，IKHSFD）：一次调用同时续租
     * 〔lease_expires_at 顺延〕+ 保持进度不倒退。守卫未命中或 DB 异常均返回 false：
     * 任务已被新 worker 接管（或已终态），调用方据此中止转存——本 worker 静默退出，
     * 已转存 TOS 对象成孤儿与家族口径一致（无 Asset 行、不留半成品悬挂）。
     */
    private boolean renewLeaseForResultTransfer(ClaimedVideoMattingJobDto claim) {
        try {
            boolean renewed = stateMachine.updateVideoMattingProgress(
                    new UpdateVideoMattingProgressDto(
                            claim.id(), claim.workerId(), claim.fencingToken(), claim.progress()));
            if (!renewed) {
                log.warn("[video_matting] 结果转存续租未命中(已被接管/终态)，中止转存 jobId={}",
                        claim.id());
            }
            return renewed;
        } catch (Exception e) {
            log.warn("[video_matting] 结果转存续租 DB 异常，中止转存 jobId={}: {}",
                    claim.id(), e.getMessage(), e);
            return false;
        }
    }

    // ========== 瞬时轮询错误判定（视频骨架 isTransientPollError 同语义） ==========

    /**
     * 瞬时轮询错误判定（去字幕 isTransientPollError 同语义）：网络超时 / 不可达 → 瞬时；
     * HTTP 429/5xx（cause 携带状态）→ 瞬时；4xx 与业务失败 → 非瞬时。
     */
    static boolean isTransientPollError(VideoMattingError error) {
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

    /**
     * 失败码归一（契约）：§5 分类信号（额度/内容政策）保留既有码，其余一律归并兜底
     * video_matting_failed（1050）。
     */
    private static String resolveFailCode(Exception e) {
        if (e instanceof VideoMattingError vm && PRESERVED_ERROR_CODES.contains(vm.getCode())) {
            return vm.getCode();
        }
        return VideoMattingContract.ERROR_VIDEO_MATTING_FAILED;
    }

    /**
     * 上游任务 failed 的错误码分类（§5 优先级；去字幕分类链同款：
     * 版权 → 内容政策 → 额度 → 兜底 1050）。
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
        return VideoMattingContract.ERROR_VIDEO_MATTING_FAILED;
    }

    /** 失败处理：走视频版 failVideoJob（轮询型任务守卫多清 next_poll_at，视频骨架语义对齐；
     *  智能抠像无输出槽位，槽位段天然空转；details.raw 透传原始原因）。 */
    private void failClaimed(ClaimedVideoMattingJobDto claim, String code, String msg) {
        log.warn("video_matting job 失败 jobId={} code={} message={}", claim.id(), code, msg);
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
            log.error("[video_matting] scheduleNext MQ 发送失败 jobId={} delayMs={}: {}",
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
