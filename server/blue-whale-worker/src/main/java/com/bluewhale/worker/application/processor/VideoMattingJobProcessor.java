package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishVideoMattingDto;
import com.bluewhale.worker.domain.dto.UpdateVideoMattingProgressDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.GenerationErrorDetailContract;
import com.bluewhale.worker.domain.contract.VideoMattingContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoMattingError;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.common.http.NewApiHttpSupport;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMatteVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMatteVideoClient.MatteVideoTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

@Component
public class VideoMattingJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(VideoMattingJobProcessor.class);

    private static final Set<String> PRESERVED_ERROR_CODES = Set.of(
            GenerationError.ERROR_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    public static final long VIDEO_MATTING_POLL_INTERVAL_MS = 5_000;

    public static final int MAX_VIDEO_MATTING_POLLS = 720;

    private static final int LEASE_SECONDS = 420;
    private static final List<String> CLAIM_SOURCES = List.of(VideoMattingContract.SOURCE);

    static final long RESULT_TRANSFER_LEASE_RENEW_INTERVAL_MS = 60_000;

    private static final ScheduledExecutorService LEASE_HEARTBEAT_SCHEDULER =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "vmatt-lease-heartbeat");
                t.setDaemon(true);
                return t;
            });

    private final JobStateMachineService stateMachine;
    private final JobFinalizer finalizer;
    private final JobClaimService claimService;
    private final ClaimSpec claimSpec;
    private final AssetSourceService assetSource;
    private final UpstreamCredential upstreamCredential;
    private final NewApiMediaKitMatteVideoClient matteVideoClient;
    private final TosVideoMediaRelay mediaRelay;
    private final GenerationMessageProducer producer;
    private final String workerId;

    long leaseRenewIntervalMs = RESULT_TRANSFER_LEASE_RENEW_INTERVAL_MS;

    int publishSettleProbeAttempts = 3;
    long publishSettleProbeDelayMs = 500;

    public VideoMattingJobProcessor(
            JobStateMachineService stateMachine,
            JobClaimService claimService,
            GenerationJobMapper jobMapper,
            JobFinalizer finalizer,
            AssetSourceService assetSource,
            UpstreamCredential upstreamCredential,
            NewApiMediaKitMatteVideoClient matteVideoClient,
            TosVideoMediaRelay mediaRelay,
            @Qualifier("videoMattingMessageProducer")
            GenerationMessageProducer producer
    ) {
        this.stateMachine = stateMachine;
        this.finalizer = finalizer;
        this.claimService = claimService;
        this.claimSpec = ClaimSpec.bySources(
                VideoMattingContract.TAG, LEASE_SECONDS, CLAIM_SOURCES, jobMapper);
        this.assetSource = assetSource;
        this.upstreamCredential = upstreamCredential;
        this.matteVideoClient = matteVideoClient;
        this.mediaRelay = mediaRelay;
        this.producer = producer;
        this.workerId = "vmatt-" + hostname() + "-" + ProcessHandle.current().pid();
    }

    @Override
    public String tag() {
        return VideoMattingContract.TAG;
    }

    @Override
    public Optional<ClaimSpec> claimSpec() {
        return Optional.of(claimSpec);
    }

    @Override
    public void handle(String jobId) {
        Optional<ClaimedJob> claimOpt;
        try {
            claimOpt = claimService.claim(claimSpec, jobId, workerId);
        } catch (Exception error) {
            log.error("[video_matting] claim 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error;
        }
        if (claimOpt.isEmpty()) return;

        ClaimedJob claim = claimOpt.get();
        log.info("[video_matting] 已领取 jobId={} token={} providerTaskId={} pollCount={}",
                claim.id(), claim.fencingToken(), claim.providerTaskId(), claim.pollCount());

        try {
            runStep(claim);
        } catch (Exception e) {
            String code = resolveFailCode(e);
            Integer httpStatus = NewApiHttpSupport.upstreamHttpStatus(e);
            String message = e.getMessage() != null ? e.getMessage() : "智能抠像失败";
            if (httpStatus != null) {
                message = message.replaceAll(": HTTP " + httpStatus + "\\b", ":");
            }
            log.error("[video_matting] 终态失败 jobId={} code={}: {}", claim.id(), code, message, e);
            failClaimed(claim, code, message, httpStatus);
        }
    }

    private void runStep(ClaimedJob claim) {
        String providerToken;
        try {
            providerToken = upstreamCredential.requireKey();
        } catch (IllegalStateException e) {
            log.warn("[video_matting] 生成服务凭证未配置 jobId={}: {}", claim.id(), e.getMessage());
            failClaimed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING, "生成服务凭证未配置");
            return;
        }

        if (claim.providerTaskId() == null) {
            submitPhase(claim, providerToken);
        } else {
            pollPhase(claim, providerToken);
        }
    }


    private void submitPhase(ClaimedJob claim, String providerToken) {
        if (claim.parentProviderTaskId() != null) {
            if (ParentResultReuse.tryReuseParentResult(VideoMattingContract.TAG, claim, providerToken,
                    matteVideoClient::poll,
                    this::mattingResultIncomplete,
                    this::publishResult)) {
                return;
            }
        }

        Map<String, Object> input = claim.input();

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
            if (backgroundColor == null
                    || !VideoMattingContract.SUPPORTED_BACKGROUND_COLORS.contains(backgroundColor)) {
                failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "MP4 背景色非法或缺失");
                return;
            }
        } else if (backgroundColorObj != null) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT,
                    "WEBM 透明输出不接受 background_color");
            return;
        }

        AssetEntity source = assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.userId()),
                Long.parseLong(claim.projectId()));
        if (source == null || !"video".equals(source.getType())
                || source.getUrl() == null || source.getUrl().isEmpty()) {
            failClaimed(claim, VideoMattingContract.ERROR_VIDEO_MATTING_FAILED,
                    "源视频素材不可用");
            return;
        }

        if (claim.parentProviderTaskId() != null && !stateMachine.reserveParentReuseSubmit(
                claim.id(), claim.workerId(), claim.fencingToken())) {
            log.warn("[video_matting] 重试收割回退提交前执行权守卫未命中（owner/fence 已变或已提交），停止本次执行 jobId={}", claim.id());
            return;
        }
        String taskId = matteVideoClient.submit(
                providerToken, source.getUrl(), mode, format,
                "MP4".equals(format) ? backgroundColor : null);
        log.info("[video_matting] 上游已提交 jobId={} providerTaskId={} mode={} format={} backgroundColor={}",
                claim.id(), taskId, mode, format, "MP4".equals(format) ? backgroundColor : null);

        boolean updated = stateMachine.markProviderSubmitted(
                claim.id(), claim.workerId(), claim.fencingToken(), taskId);
        if (updated) {
            scheduleNext(claim.id(), VIDEO_MATTING_POLL_INTERVAL_MS);
        }
    }

    private String mattingResultIncomplete(ClaimedJob claim,
                                           MatteVideoTaskObservation observation) {
        if (observation.videoUrl() == null || observation.videoUrl().isEmpty()) {
            return "结果视频缺失";
        }
        if (observation.resolution() == null || observation.resolution().isEmpty()) {
            return "缺分辨率档位";
        }
        return null;
    }


    private void pollPhase(ClaimedJob claim, String providerToken) {
        MatteVideoTaskObservation observation;
        try {
            observation = matteVideoClient.poll(providerToken, claim.providerTaskId());
        } catch (VideoMattingError pollError) {
            if (isTransientPollError(pollError)) {
                if (claim.pollCount() >= MAX_VIDEO_MATTING_POLLS) {
                    log.warn("[video_matting] 轮询瞬时错误且已达轮询上限 jobId={} pollCount={} err={}，归失败终态",
                            claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                    failClaimed(claim, VideoMattingContract.ERROR_VIDEO_MATTING_FAILED,
                            "智能抠像轮询超时（超过 " + MAX_VIDEO_MATTING_POLLS + " 次）",
                            NewApiHttpSupport.upstreamHttpStatus(pollError));
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
            String message = observation.upstreamMessage() != null && !observation.upstreamMessage().isEmpty()
                    ? observation.upstreamMessage() : "智能抠像任务失败";
            String code = classifyUpstreamFailure(observation.upstreamCode(), observation.upstreamMessage());
            log.info("[video_matting] 上游状态终态=failed jobId={} providerTaskId={} code={} pollCount={}",
                    claim.id(), claim.providerTaskId(), code, claim.pollCount());
            failClaimed(claim, code, message);
            return;
        }

        log.info("[video_matting] 上游状态终态=completed jobId={} providerTaskId={} pollCount={} resolution={} duration={}",
                claim.id(), claim.providerTaskId(), claim.pollCount(),
                observation.resolution(), observation.durationSec());
        if (observation.videoUrl() == null || observation.videoUrl().isEmpty()) {
            failClaimed(claim, VideoMattingContract.ERROR_VIDEO_MATTING_FAILED,
                    "智能抠像任务成功但未返回结果视频");
            return;
        }
        if (observation.resolution() == null || observation.resolution().isEmpty()) {
            failClaimed(claim, VideoMattingContract.ERROR_VIDEO_MATTING_FAILED,
                    "智能抠像任务成功但未返回分辨率档位");
            return;
        }
        publishResult(claim, observation);
    }

    private boolean publishResult(ClaimedJob claim,
                                  MatteVideoTaskObservation observation) {
        if (mediaRelay == null) {
            throw new VideoMattingError(
                    VideoMattingContract.ERROR_VIDEO_MATTING_FAILED,
                    "智能抠像转存存储未配置");
        }

        if (!renewLeaseForResultTransfer(claim)) {
            return true;
        }

        Integer width = null;
        Integer height = null;
        Double sourceDurationSec = null;
        String sourceAssetId = parseAssetId(
                claim.input().get(VideoMattingContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId != null) {
            AssetEntity source = assetSource.resolve(
                    Long.parseLong(sourceAssetId),
                    Long.parseLong(claim.userId()),
                    Long.parseLong(claim.projectId()));
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
        TosVideoMediaRelay.TransferAbortHandle abortHandle = new TosVideoMediaRelay.TransferAbortHandle();
        ScheduledFuture<?> heartbeat = LEASE_HEARTBEAT_SCHEDULER.scheduleAtFixedRate(
                () -> {
                    if (!renewLeaseForResultTransfer(claim)) {
                        abortHandle.abort("结果转存期租约未命中（已被接管/终态）");
                    }
                },
                leaseRenewIntervalMs, leaseRenewIntervalMs, TimeUnit.MILLISECONDS);
        try {
            stored = mediaRelay.persistStreaming(observation.videoUrl(), claim.userId(),
                    VideoMattingContract.MAX_RESULT_BYTES, abortHandle);
        } catch (TosVideoMediaRelay.TransferAbortedException e) {
            log.warn("[video_matting] 结果转存被中止，本 worker 静默退出 jobId={}: {}", claim.id(), e.getMessage());
            return true;
        } catch (Exception e) {
            if (claim.parentProviderTaskId() != null) {
                boolean leaseConfirmed = !abortHandle.aborted() && renewLeaseForResultTransfer(claim);
                if (!leaseConfirmed || abortHandle.aborted()) {
                    log.warn("[video_matting] 结果转存异常后执行权无法确认，停止本次执行 jobId={}", claim.id());
                    return true;
                }
            }
            VideoMattingError transferFailure = new VideoMattingError(
                    VideoMattingContract.ERROR_VIDEO_MATTING_FAILED,
                    "抠像结果视频下载转存失败: " + e.getMessage());
            transferFailure.initCause(e);
            throw transferFailure;
        } finally {
            heartbeat.cancel(false);
        }
        if (abortHandle.aborted()) {
            discardUnpublishedTransfer(claim, stored);
            return true;
        }
        log.info("[video_matting] 转存完成 jobId={} storageKey={} size={} resolution={}",
                claim.id(), stored.storageKey(), stored.size(), observation.resolution());

        boolean published;
        try {
            published = finalizer.publishVideoMattingResult(new PublishVideoMattingDto(
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
                    width,
                    height,
                    durationSec,
                    observation.resolution()));
        } catch (Exception error) {
            discardUnpublishedTransfer(claim, stored, true);
            throw error;
        }
        if (published) {
            log.info("[video_matting] 发布成功 jobId={}", claim.id());
        } else {
            log.warn("[video_matting] 终态失败(发布守卫未命中) jobId={}（stale worker 或已终态）",
                    claim.id());
            discardUnpublishedTransfer(claim, stored);
        }
        return published;
    }

    private void discardUnpublishedTransfer(ClaimedJob claim,
                                            TosVideoMediaRelay.StoredVideo stored) {
        discardUnpublishedTransfer(claim, stored, false);
    }

    private void discardUnpublishedTransfer(ClaimedJob claim,
                                            TosVideoMediaRelay.StoredVideo stored,
                                            boolean publishOutcomeUncertain) {
        try {
            if (publishOutcomeUncertain) {
                switch (awaitPublishSettledAndUnreferenced(claim.id(), stored.storageKey())) {
                    case REFERENCED -> {
                        log.warn("[video_matting] 发布结果不明但对象已被 Asset 引用，保留不清理 jobId={} storageKey={}",
                                claim.id(), stored.storageKey());
                        return;
                    }
                    case UNCONFIRMED -> {
                        logPendingTransferCleanup(claim.id(), stored.storageKey(),
                                "发布结果不明：有界重查内可能发布该键的事务仍未结束");
                        return;
                    }
                    case SETTLED_UNREFERENCED -> {                      }
                }
            } else if (finalizer.hasPublishedAsset(claim.id(), stored.storageKey())) {
                log.warn("[video_matting] 转存对象已被 Asset 引用，保留不清理 jobId={} storageKey={}",
                        claim.id(), stored.storageKey());
                return;
            }
            mediaRelay.deleteUnpublishedObject(stored.storageKey());
        } catch (Exception error) {
            logPendingTransferCleanup(claim.id(), stored.storageKey(),
                    "权威状态核实或删除异常: " + error.getMessage());
        }
    }

    private enum UnpublishedTransferCheck {
        REFERENCED,
        SETTLED_UNREFERENCED,
        UNCONFIRMED
    }

    private UnpublishedTransferCheck awaitPublishSettledAndUnreferenced(String jobId, String storageKey) {
        for (int attempt = 1; ; attempt++) {
            if (finalizer.hasInFlightJobWriteTransaction(jobId)) {
                if (attempt >= publishSettleProbeAttempts) return UnpublishedTransferCheck.UNCONFIRMED;
                try {
                    Thread.sleep(publishSettleProbeDelayMs);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("发布落定核实等待被中断", interrupted);
                }
                continue;
            }
            return finalizer.hasPublishedAsset(jobId, storageKey)
                    ? UnpublishedTransferCheck.REFERENCED
                    : UnpublishedTransferCheck.SETTLED_UNREFERENCED;
        }
    }

    private static void logPendingTransferCleanup(String jobId, String storageKey, String reason) {
        log.warn("[video_matting][pending-cleanup] 未发布对象保守保留待处理 jobId={} storageKey={} reason={} resolution=retain-pending",
                jobId, storageKey, reason);
    }

    private boolean renewLeaseForResultTransfer(ClaimedJob claim) {
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


    private static String parseAssetId(Object obj) {
        if (obj instanceof String s && !s.isEmpty()) return s;
        if (obj instanceof Number n) return String.valueOf(n.longValue());
        return null;
    }

    private static String resolveFailCode(Exception e) {
        if (e instanceof VideoMattingError vm && PRESERVED_ERROR_CODES.contains(vm.getCode())) {
            return vm.getCode();
        }
        return VideoMattingContract.ERROR_VIDEO_MATTING_FAILED;
    }

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

    private void failClaimed(ClaimedJob claim, String code, String msg) {
        failClaimed(claim, code, msg, null);
    }

    private void failClaimed(ClaimedJob claim, String code, String msg,
                             Integer httpStatus) {
        log.warn("video_matting job 失败 jobId={} code={} message={}", claim.id(), code, msg);
        Map<String, Object> details = new HashMap<>();
        details.put("raw", msg);
        if (httpStatus != null) {
            details.put(GenerationErrorDetailContract.ERROR_DETAIL_HTTP_STATUS, httpStatus);
        }
        finalizer.failVideoJob(claim.id(), code, msg, details,
                claim.workerId(), claim.fencingToken());
    }

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
