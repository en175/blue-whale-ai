package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishVideoEnhanceDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.GenerationErrorDetailContract;
import com.bluewhale.worker.domain.contract.VideoEnhanceContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoEnhanceError;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.common.http.NewApiHttpSupport;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitEnhanceVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitEnhanceVideoClient.EnhanceVideoTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
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

@Component
public class VideoEnhanceJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(VideoEnhanceJobProcessor.class);

    private static final Set<String> PRESERVED_ERROR_CODES = Set.of(
            GenerationError.ERROR_PLATFORM_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    public static final long VIDEO_ENHANCE_POLL_INTERVAL_MS = 5_000;

    public static final int MAX_VIDEO_ENHANCE_POLLS = 720;

    private static final int LEASE_SECONDS = 420;
    private static final List<String> CLAIM_SOURCES = List.of(VideoEnhanceContract.SOURCE);

    private final JobStateMachineService stateMachine;
    private final JobFinalizer finalizer;
    private final JobClaimService claimService;
    private final ClaimSpec claimSpec;
    private final AssetSourceService assetSource;
    private final UpstreamCredential upstreamCredential;
    private final NewApiMediaKitEnhanceVideoClient enhanceVideoClient;
    private final TosVideoMediaRelay mediaRelay;
    private final GenerationMessageProducer producer;
    private final String workerId;

    public VideoEnhanceJobProcessor(
            JobStateMachineService stateMachine,
            JobClaimService claimService,
            GenerationJobMapper jobMapper,
            JobFinalizer finalizer,
            AssetSourceService assetSource,
            UpstreamCredential upstreamCredential,
            NewApiMediaKitEnhanceVideoClient enhanceVideoClient,
            TosVideoMediaRelay mediaRelay,
            @Qualifier("videoEnhanceMessageProducer")
            GenerationMessageProducer producer
    ) {
        this.stateMachine = stateMachine;
        this.finalizer = finalizer;
        this.claimService = claimService;
        this.claimSpec = ClaimSpec.bySources(
                VideoEnhanceContract.TAG, LEASE_SECONDS, CLAIM_SOURCES, jobMapper);
        this.assetSource = assetSource;
        this.upstreamCredential = upstreamCredential;
        this.enhanceVideoClient = enhanceVideoClient;
        this.mediaRelay = mediaRelay;
        this.producer = producer;
        this.workerId = "venh-" + hostname() + "-" + ProcessHandle.current().pid();
    }

    @Override
    public String tag() {
        return VideoEnhanceContract.TAG;
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
            log.error("[video_enhance] claim 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error;
        }
        if (claimOpt.isEmpty()) return;

        ClaimedJob claim = claimOpt.get();
        log.info("[video_enhance] 已领取 jobId={} token={} providerTaskId={} pollCount={}",
                claim.id(), claim.fencingToken(), claim.providerTaskId(), claim.pollCount());

        try {
            runStep(claim);
        } catch (Exception e) {
            String code = resolveFailCode(e);
            Integer httpStatus = NewApiHttpSupport.upstreamHttpStatus(e);
            String message = e.getMessage() != null ? e.getMessage() : "视频画质增强失败";
            if (httpStatus != null) {
                message = message.replaceAll(": HTTP " + httpStatus + "\\b", ":");
            }
            log.error("[video_enhance] 终态失败 jobId={} code={}: {}", claim.id(), code, message, e);
            failClaimed(claim, code, message, httpStatus);
        }
    }

    private void runStep(ClaimedJob claim) {
        String providerToken;
        try {
            providerToken = upstreamCredential.requireKey();
        } catch (IllegalStateException e) {
            log.warn("[video_enhance] 生成服务凭证未配置 jobId={}: {}", claim.id(), e.getMessage());
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
            if (ParentResultReuse.tryReuseParentResult(VideoEnhanceContract.TAG, claim, providerToken,
                    enhanceVideoClient::poll,
                    ParentResultReuse.singleUrlIncomplete(EnhanceVideoTaskObservation::videoUrl),
                    this::publishResult)) {
                return;
            }
        }

        Map<String, Object> input = claim.input();

        String sourceAssetId = parseAssetId(input.get(VideoEnhanceContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId == null) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "缺少源视频资产 id");
            return;
        }
        Object resolutionObj = input.get(VideoEnhanceContract.INPUT_KEY_RESOLUTION);
        if (!(resolutionObj instanceof String resolution)
                || !VideoEnhanceContract.SUPPORTED_RESOLUTIONS.contains(resolution)) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "画质增强目标分辨率非法");
            return;
        }

        AssetEntity source = assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.userId()),
                Long.parseLong(claim.projectId()));
        if (source == null || !"video".equals(source.getType())
                || source.getUrl() == null || source.getUrl().isEmpty()) {
            failClaimed(claim, VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED,
                    "源视频资产不可用");
            return;
        }

        if (claim.parentProviderTaskId() != null && !stateMachine.reserveParentReuseSubmit(
                claim.id(), claim.workerId(), claim.fencingToken())) {
            return;
        }
        String taskId = enhanceVideoClient.submit(providerToken, source.getUrl(), resolution);
        log.info("[video_enhance] 上游已提交 jobId={} providerTaskId={} resolution={}",
                claim.id(), taskId, resolution);

        boolean updated = stateMachine.markProviderSubmitted(
                claim.id(), claim.workerId(), claim.fencingToken(), taskId);
        if (updated) {
            scheduleNext(claim.id(), VIDEO_ENHANCE_POLL_INTERVAL_MS);
        }
    }


    private void pollPhase(ClaimedJob claim, String providerToken) {
        EnhanceVideoTaskObservation observation;
        try {
            observation = enhanceVideoClient.poll(providerToken, claim.providerTaskId());
        } catch (VideoEnhanceError pollError) {
            if (isTransientPollError(pollError)) {
                if (claim.pollCount() >= MAX_VIDEO_ENHANCE_POLLS) {
                    log.warn("[video_enhance] 轮询瞬时错误且已达轮询上限 jobId={} pollCount={} err={}，归失败终态",
                            claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                    Integer httpStatus = NewApiHttpSupport.upstreamHttpStatus(pollError);
                    String message = "画质增强轮询超时（超过 " + MAX_VIDEO_ENHANCE_POLLS
                            + " 次），上游持续错误: " + pollError.getMessage();
                    if (httpStatus != null) {
                        message = message.replaceAll(": HTTP " + httpStatus + "\\b", ":");
                    }
                    failClaimed(claim, VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED,
                            message, httpStatus);
                    return;
                }
                log.warn("[video_enhance] 轮询瞬时错误 jobId={} pollCount={} err={}，重排继续轮询",
                        claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                boolean updated = stateMachine.rescheduleProviderPoll(
                        claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
                if (updated) {
                    scheduleNext(claim.id(), VIDEO_ENHANCE_POLL_INTERVAL_MS);
                }
                return;
            }
            throw pollError;
        }

        if ("processing".equals(observation.status())) {
            if (claim.pollCount() >= MAX_VIDEO_ENHANCE_POLLS) {
                failClaimed(claim, VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED,
                        "画质增强轮询超时（超过 " + MAX_VIDEO_ENHANCE_POLLS + " 次）");
                return;
            }
            boolean updated = stateMachine.rescheduleProviderPoll(
                    claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
            if (updated) {
                scheduleNext(claim.id(), VIDEO_ENHANCE_POLL_INTERVAL_MS);
            }
            return;
        }

        if ("failed".equals(observation.status())) {
            String message = observation.upstreamMessage() != null && !observation.upstreamMessage().isEmpty()
                    ? observation.upstreamMessage() : "画质增强任务失败";
            String code = classifyUpstreamFailure(observation.upstreamCode(), observation.upstreamMessage());
            log.info("[video_enhance] 上游状态终态=failed jobId={} providerTaskId={} code={} pollCount={}",
                    claim.id(), claim.providerTaskId(), code, claim.pollCount());
            failClaimed(claim, code, message);
            return;
        }

        log.info("[video_enhance] 上游状态终态=completed jobId={} providerTaskId={} pollCount={}",
                claim.id(), claim.providerTaskId(), claim.pollCount());
        if (observation.videoUrl() == null || observation.videoUrl().isEmpty()) {
            failClaimed(claim, VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED,
                    "画质增强任务成功但未返回结果视频");
            return;
        }
        publishResult(claim, observation);
    }

    private boolean publishResult(ClaimedJob claim,
                                  EnhanceVideoTaskObservation observation) {
        if (mediaRelay == null) {
            throw new VideoEnhanceError(
                    VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED,
                    "画质增强转存存储未配置");
        }
        TosVideoMediaRelay.StoredVideo stored =
                mediaRelay.persist(observation.videoUrl(), claim.userId());
        log.info("[video_enhance] 转存完成 jobId={} storageKey={} size={}",
                claim.id(), stored.storageKey(), stored.size());

        AssetEntity source = resolveSource(claim);
        String resolution = resolveOutputResolution(claim, observation.resolution());
        int[] dimensions = deriveOutputDimensions(source, resolution);

        Double sourceDurationSec = null;
        if (source != null && source.getDurationMs() != null) {
            sourceDurationSec = source.getDurationMs() / 1000.0;
        }
        Double durationSec = observation.durationSec() != null
                ? observation.durationSec() : sourceDurationSec;

        boolean published = finalizer.publishVideoEnhanceResult(new PublishVideoEnhanceDto(
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
                dimensions != null ? dimensions[0] : null,
                dimensions != null ? dimensions[1] : null,
                durationSec,
                resolution,
                observation.fps()));
        if (published) {
            log.info("[video_enhance] 发布成功 jobId={}", claim.id());
        } else {
            log.warn("[video_enhance] 终态失败(发布守卫未命中) jobId={}（stale worker 或已终态）",
                    claim.id());
        }
        return published;
    }


    static boolean isTransientPollError(VideoEnhanceError error) {
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

    private AssetEntity resolveSource(ClaimedJob claim) {
        String sourceAssetId = parseAssetId(
                claim.input().get(VideoEnhanceContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId == null) return null;
        return assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.userId()),
                Long.parseLong(claim.projectId()));
    }

    private static String resolveOutputResolution(ClaimedJob claim, String upstream) {
        if (upstream != null) {
            String normalized = upstream.toLowerCase();
            if (VideoEnhanceContract.RESOLUTION_SHORT_SIDE_PX.containsKey(normalized)) {
                return normalized;
            }
        }
        Object frozen = claim.input().get(VideoEnhanceContract.INPUT_KEY_RESOLUTION);
        return frozen instanceof String s ? s : null;
    }

    static int[] deriveOutputDimensions(AssetEntity source, String resolution) {
        if (source == null || resolution == null) return null;
        Integer shortSide = VideoEnhanceContract.RESOLUTION_SHORT_SIDE_PX.get(resolution);
        Integer srcWidth = source.getWidth();
        Integer srcHeight = source.getHeight();
        if (shortSide == null || srcWidth == null || srcHeight == null
                || srcWidth <= 0 || srcHeight <= 0) {
            return null;
        }
        int srcShort = Math.min(srcWidth, srcHeight);
        int srcLong = Math.max(srcWidth, srcHeight);
        int outShort = shortSide;
        int outLong = Math.round((float) srcLong * outShort / srcShort);
        if (outLong % 2 != 0) outLong += 1;
        return srcWidth <= srcHeight
                ? new int[]{outShort, outLong} : new int[]{outLong, outShort};
    }

    private static String resolveFailCode(Exception e) {
        if (e instanceof VideoEnhanceError vee && PRESERVED_ERROR_CODES.contains(vee.getCode())) {
            return vee.getCode();
        }
        return VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED;
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
            return GenerationError.ERROR_PLATFORM_QUOTA_EXHAUSTED;
        }
        return VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED;
    }

    private void failClaimed(ClaimedJob claim, String code, String msg) {
        failClaimed(claim, code, msg, null);
    }

    private void failClaimed(ClaimedJob claim, String code, String msg,
                             Integer httpStatus) {
        log.warn("video_enhance job 失败 jobId={} code={} message={}", claim.id(), code, msg);
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
            log.error("[video_enhance] scheduleNext MQ 发送失败 jobId={} delayMs={}: {}",
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
