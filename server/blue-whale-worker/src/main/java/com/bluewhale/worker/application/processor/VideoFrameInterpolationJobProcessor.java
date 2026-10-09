package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.contract.GenerationErrorDetailContract;
import com.bluewhale.worker.domain.contract.VideoFrameInterpolationContract;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishVideoFrameInterpolationDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoFrameInterpolationError;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.common.http.NewApiHttpSupport;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitInterpolateVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitInterpolateVideoClient.InterpolateVideoTaskObservation;
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

@Component
public class VideoFrameInterpolationJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(VideoFrameInterpolationJobProcessor.class);

    private static final Set<String> PRESERVED_ERROR_CODES = Set.of(
            GenerationError.ERROR_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    public static final long VIDEO_FRAME_INTERPOLATION_POLL_INTERVAL_MS = 5_000;

    public static final int MAX_VIDEO_FRAME_INTERPOLATION_POLLS = 720;

    private static final int LEASE_SECONDS = 420;
    private static final List<String> CLAIM_SOURCES = List.of(VideoFrameInterpolationContract.SOURCE);

    private final JobStateMachineService stateMachine;
    private final JobFinalizer finalizer;
    private final JobClaimService claimService;
    private final ClaimSpec claimSpec;
    private final AssetSourceService assetSource;
    private final UpstreamCredential upstreamCredential;
    private final NewApiMediaKitInterpolateVideoClient interpolateVideoClient;
    private final TosVideoMediaRelay mediaRelay;
    private final GenerationMessageProducer producer;
    private final String workerId;

    public VideoFrameInterpolationJobProcessor(
            JobStateMachineService stateMachine,
            JobClaimService claimService,
            GenerationJobMapper jobMapper,
            JobFinalizer finalizer,
            AssetSourceService assetSource,
            UpstreamCredential upstreamCredential,
            NewApiMediaKitInterpolateVideoClient interpolateVideoClient,
            TosVideoMediaRelay mediaRelay,
            @Qualifier("videoFrameInterpolationMessageProducer")
            GenerationMessageProducer producer
    ) {
        this.stateMachine = stateMachine;
        this.finalizer = finalizer;
        this.claimService = claimService;
        this.claimSpec = ClaimSpec.bySources(
                VideoFrameInterpolationContract.TAG, LEASE_SECONDS, CLAIM_SOURCES, jobMapper);
        this.assetSource = assetSource;
        this.upstreamCredential = upstreamCredential;
        this.interpolateVideoClient = interpolateVideoClient;
        this.mediaRelay = mediaRelay;
        this.producer = producer;
        this.workerId = "vfi-" + hostname() + "-" + ProcessHandle.current().pid();
    }

    @Override
    public String tag() {
        return VideoFrameInterpolationContract.TAG;
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
            log.error("[video_frame_interpolation] claim 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error;
        }
        if (claimOpt.isEmpty()) return;

        ClaimedJob claim = claimOpt.get();
        log.info("[video_frame_interpolation] 已领取 jobId={} token={} providerTaskId={} pollCount={}",
                claim.id(), claim.fencingToken(), claim.providerTaskId(), claim.pollCount());

        try {
            runStep(claim);
        } catch (Exception e) {
            String code = resolveFailCode(e);
            Integer httpStatus = NewApiHttpSupport.upstreamHttpStatus(e);
            String message = e.getMessage() != null ? e.getMessage() : "视频插帧失败";
            if (httpStatus != null) {
                message = message.replaceAll(": HTTP " + httpStatus + "\\b", ":");
            }
            log.error("[video_frame_interpolation] 终态失败 jobId={} code={}: {}",
                    claim.id(), code, message, e);
            failClaimed(claim, code, message, httpStatus);
        }
    }

    private void runStep(ClaimedJob claim) {
        if (claim.cancelRequested()) {
            log.info("[video_frame_interpolation] 取消已执行 jobId={} providerTaskId={}",
                    claim.id(), claim.providerTaskId());
            stateMachine.cancelVideoFrameInterpolation(
                    claim.id(), claim.workerId(), claim.fencingToken(), claim.providerTaskId());
            return;
        }

        String providerToken;
        try {
            providerToken = upstreamCredential.requireKey();
        } catch (IllegalStateException e) {
            log.warn("[video_frame_interpolation] 生成服务凭证未配置 jobId={}: {}", claim.id(), e.getMessage());
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
            if (ParentResultReuse.tryReuseParentResult(VideoFrameInterpolationContract.TAG, claim, providerToken,
                    interpolateVideoClient::poll,
                    ParentResultReuse.singleUrlIncomplete(InterpolateVideoTaskObservation::videoUrl),
                    this::publishResult)) {
                return;
            }
        }

        Map<String, Object> input = claim.input();

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

        AssetEntity source = assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.userId()),
                Long.parseLong(claim.projectId()));
        if (source == null || !"video".equals(source.getType())
                || source.getUrl() == null || source.getUrl().isEmpty()) {
            failClaimed(claim, VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED,
                    "源视频资产不可用");
            return;
        }

        if (claim.parentProviderTaskId() != null && !stateMachine.reserveParentReuseSubmit(
                claim.id(), claim.workerId(), claim.fencingToken())) {
            return;
        }
        String taskId = interpolateVideoClient.submit(providerToken, source.getUrl(), fps);
        log.info("[video_frame_interpolation] 上游已提交 jobId={} providerTaskId={} fps={}",
                claim.id(), taskId, fps);

        boolean updated = stateMachine.markProviderSubmitted(
                claim.id(), claim.workerId(), claim.fencingToken(), taskId);
        if (updated) {
            scheduleNext(claim.id(), VIDEO_FRAME_INTERPOLATION_POLL_INTERVAL_MS);
        }
    }


    private void pollPhase(ClaimedJob claim, String providerToken) {
        InterpolateVideoTaskObservation observation;
        try {
            observation = interpolateVideoClient.poll(providerToken, claim.providerTaskId());
        } catch (VideoFrameInterpolationError pollError) {
            if (isTransientPollError(pollError)) {
                if (claim.pollCount() >= MAX_VIDEO_FRAME_INTERPOLATION_POLLS) {
                    String reason = pollError.getMessage() != null
                            ? pollError.getMessage() : "上游持续瞬时错误";
                    log.warn("[video_frame_interpolation] 轮询瞬时错误且预算耗尽 jobId={} pollCount={} err={}，落终态",
                            claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                    failPollBudgetExhausted(claim, "持续瞬时错误: " + reason,
                            NewApiHttpSupport.upstreamHttpStatus(pollError));
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
            String message = observation.upstreamMessage() != null && !observation.upstreamMessage().isEmpty()
                    ? observation.upstreamMessage() : "视频插帧任务失败";
            String code = classifyUpstreamFailure(observation.upstreamCode(), observation.upstreamMessage());
            log.info("[video_frame_interpolation] 上游状态终态=failed jobId={} providerTaskId={} code={} pollCount={}",
                    claim.id(), claim.providerTaskId(), code, claim.pollCount());
            failClaimed(claim, code, message);
            return;
        }

        log.info("[video_frame_interpolation] 上游状态终态=completed jobId={} providerTaskId={} pollCount={}",
                claim.id(), claim.providerTaskId(), claim.pollCount());
        if (observation.videoUrl() == null || observation.videoUrl().isEmpty()) {
            failClaimed(claim, VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED,
                    "插帧任务成功但未返回结果视频");
            return;
        }
        publishResult(claim, observation);
    }

    private boolean publishResult(ClaimedJob claim,
                                  InterpolateVideoTaskObservation observation) {
        if (mediaRelay == null) {
            throw new VideoFrameInterpolationError(
                    VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED,
                    "视频插帧转存存储未配置");
        }
        TosVideoMediaRelay.StoredVideo stored =
                mediaRelay.persist(observation.videoUrl(), claim.userId());
        log.info("[video_frame_interpolation] 转存完成 jobId={} storageKey={} size={}",
                claim.id(), stored.storageKey(), stored.size());

        AssetEntity source = resolveSource(claim);
        Integer width = source != null ? source.getWidth() : null;
        Integer height = source != null ? source.getHeight() : null;

        Double sourceDurationSec = null;
        if (source != null && source.getDurationMs() != null) {
            sourceDurationSec = source.getDurationMs() / 1000.0;
        }
        Double durationSec = observation.durationSec() != null
                ? observation.durationSec() : sourceDurationSec;

        Double fps = observation.fps() != null ? observation.fps() : frozenFps(claim);

        boolean published = finalizer.publishVideoFrameInterpolationResult(
                new PublishVideoFrameInterpolationDto(
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


    private static String parseAssetId(Object obj) {
        if (obj instanceof String s && !s.isEmpty()) return s;
        if (obj instanceof Number n) return String.valueOf(n.longValue());
        return null;
    }

    static Integer parseFps(Object obj) {
        if (!(obj instanceof Number n)) return null;
        double d = n.doubleValue();
        if (Double.isInfinite(d) || Double.isNaN(d) || d != Math.floor(d)) return null;
        int value = (int) d;
        return VideoFrameInterpolationContract.SUPPORTED_FPS.contains(value) ? value : null;
    }

    private static Double frozenFps(ClaimedJob claim) {
        Integer fps = parseFps(claim.input().get(VideoFrameInterpolationContract.INPUT_KEY_FPS));
        return fps != null ? fps.doubleValue() : null;
    }

    private AssetEntity resolveSource(ClaimedJob claim) {
        String sourceAssetId = parseAssetId(
                claim.input().get(VideoFrameInterpolationContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId == null) return null;
        return assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.userId()),
                Long.parseLong(claim.projectId()));
    }

    private static String resolveFailCode(Exception e) {
        if (e instanceof VideoFrameInterpolationError vfie
                && PRESERVED_ERROR_CODES.contains(vfie.getCode())) {
            return vfie.getCode();
        }
        return VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED;
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
        return VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED;
    }

    private void failPollBudgetExhausted(ClaimedJob claim, String detail) {
        failPollBudgetExhausted(claim, detail, null);
    }

    private void failPollBudgetExhausted(ClaimedJob claim, String detail,
                                         Integer httpStatus) {
        String message = "视频插帧轮询超时（超过 " + MAX_VIDEO_FRAME_INTERPOLATION_POLLS
                + " 次" + detail + "）";
        if (httpStatus != null) {
            message = message.replaceAll(": HTTP " + httpStatus + "\\b", ":");
        }
        failClaimed(claim, VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED,
                message, httpStatus);
    }

    private void failClaimed(ClaimedJob claim, String code, String msg) {
        failClaimed(claim, code, msg, null);
    }

    private void failClaimed(ClaimedJob claim, String code, String msg,
                             Integer httpStatus) {
        log.warn("video_frame_interpolation job 失败 jobId={} code={} message={}", claim.id(), code, msg);
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
