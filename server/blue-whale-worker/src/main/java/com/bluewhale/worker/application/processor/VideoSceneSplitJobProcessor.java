package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishVideoSceneSplitDto;
import com.bluewhale.worker.domain.dto.UpdateVideoSceneSplitProgressDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.GenerationErrorDetailContract;
import com.bluewhale.worker.domain.contract.VideoSceneSplitContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoSceneSplitError;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.common.http.NewApiHttpSupport;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSegmentScenesClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSegmentScenesClient.SceneSplitTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSegmentScenesClient.SegmentObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
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

@Component
public class VideoSceneSplitJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(VideoSceneSplitJobProcessor.class);

    private static final Set<String> PRESERVED_ERROR_CODES = Set.of(
            GenerationError.ERROR_PLATFORM_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    public static final long SCENE_SPLIT_POLL_INTERVAL_MS = 5_000;

    public static final int MAX_SCENE_SPLIT_POLLS = 720;

    private static final int LEASE_SECONDS = 420;
    private static final List<String> CLAIM_SOURCES = List.of(VideoSceneSplitContract.SOURCE);

    private final JobStateMachineService stateMachine;
    private final JobFinalizer finalizer;
    private final JobClaimService claimService;
    private final ClaimSpec claimSpec;
    private final AssetSourceService assetSource;
    private final UpstreamCredential upstreamCredential;
    private final NewApiMediaKitSegmentScenesClient segmentScenesClient;
    private final TosVideoMediaRelay mediaRelay;
    private final GenerationMessageProducer producer;
    private final String workerId;

    public VideoSceneSplitJobProcessor(
            JobStateMachineService stateMachine,
            JobClaimService claimService,
            GenerationJobMapper jobMapper,
            JobFinalizer finalizer,
            AssetSourceService assetSource,
            UpstreamCredential upstreamCredential,
            NewApiMediaKitSegmentScenesClient segmentScenesClient,
            TosVideoMediaRelay mediaRelay,
            @Qualifier("videoSceneSplitMessageProducer")
            GenerationMessageProducer producer
    ) {
        this.stateMachine = stateMachine;
        this.finalizer = finalizer;
        this.claimService = claimService;
        this.claimSpec = ClaimSpec.bySources(
                VideoSceneSplitContract.TAG, LEASE_SECONDS, CLAIM_SOURCES, jobMapper);
        this.assetSource = assetSource;
        this.upstreamCredential = upstreamCredential;
        this.segmentScenesClient = segmentScenesClient;
        this.mediaRelay = mediaRelay;
        this.producer = producer;
        this.workerId = "scenesplit-" + hostname() + "-" + ProcessHandle.current().pid();
    }

    @Override
    public String tag() {
        return VideoSceneSplitContract.TAG;
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
            log.error("[video_scene_split] claim 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error;
        }
        if (claimOpt.isEmpty()) return;

        ClaimedJob claim = claimOpt.get();
        log.info("[video_scene_split] 已领取 jobId={} token={} providerTaskId={} pollCount={}",
                claim.id(), claim.fencingToken(), claim.providerTaskId(), claim.pollCount());

        try {
            runStep(claim);
        } catch (Exception e) {
            String code = resolveFailCode(e);
            Integer httpStatus = NewApiHttpSupport.upstreamHttpStatus(e);
            String message = e.getMessage() != null ? e.getMessage() : "场景切分失败";
            if (httpStatus != null) {
                message = message.replaceAll(": HTTP " + httpStatus + "\\b", ":");
            }
            log.error("[video_scene_split] 终态失败 jobId={} code={}: {}", claim.id(), code, message, e);
            failClaimed(claim, code, message, httpStatus);
        }
    }

    private void runStep(ClaimedJob claim) {
        String providerToken;
        try {
            providerToken = upstreamCredential.requireKey();
        } catch (IllegalStateException e) {
            log.warn("[video_scene_split] 生成服务凭证未配置 jobId={}: {}", claim.id(), e.getMessage());
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
            if (ParentResultReuse.tryReuseParentResult(VideoSceneSplitContract.TAG, claim, providerToken,
                    segmentScenesClient::poll,
                    this::sceneSplitResultIncomplete,
                    this::publishResult)) {
                return;
            }
        }

        Map<String, Object> input = claim.input();

        String sourceAssetId = parseAssetId(input.get(VideoSceneSplitContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId == null) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "缺少源视频资产 id");
            return;
        }
        Object granularityObj = input.get(VideoSceneSplitContract.INPUT_KEY_GRANULARITY);
        if (!(granularityObj instanceof String granularity)
                || !VideoSceneSplitContract.SUPPORTED_GRANULARITIES.contains(granularity)) {
            failClaimed(claim, GenerationError.ERROR_INVALID_INPUT, "场景切分粒度非法");
            return;
        }

        AssetEntity source = assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.userId()),
                Long.parseLong(claim.projectId()));
        if (source == null || !"video".equals(source.getType())
                || source.getUrl() == null || source.getUrl().isEmpty()) {
            failClaimed(claim, VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED,
                    "源视频素材不可用");
            return;
        }

        if (claim.parentProviderTaskId() != null && !stateMachine.reserveParentReuseSubmit(
                claim.id(), claim.workerId(), claim.fencingToken())) {
            return;
        }
        String taskId = segmentScenesClient.submit(providerToken, source.getUrl(), granularity);
        log.info("[video_scene_split] 上游已提交 jobId={} providerTaskId={} granularity={}",
                claim.id(), taskId, granularity);

        boolean updated = stateMachine.markProviderSubmitted(
                claim.id(), claim.workerId(), claim.fencingToken(), taskId);
        if (updated) {
            scheduleNext(claim.id(), SCENE_SPLIT_POLL_INTERVAL_MS);
        }
    }

    private String sceneSplitResultIncomplete(ClaimedJob claim,
                                              SceneSplitTaskObservation observation) {
        return observation.segments() == null || observation.segments().isEmpty()
                ? "切片数组为空" : null;
    }


    private void pollPhase(ClaimedJob claim, String providerToken) {
        SceneSplitTaskObservation observation;
        try {
            observation = segmentScenesClient.poll(providerToken, claim.providerTaskId());
        } catch (VideoSceneSplitError pollError) {
            if (isTransientPollError(pollError)) {
                if (claim.pollCount() >= MAX_SCENE_SPLIT_POLLS) {
                    log.warn("[video_scene_split] 轮询瞬时错误且已达轮询上限 jobId={} pollCount={} err={}，归失败终态",
                            claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                    Integer httpStatus = NewApiHttpSupport.upstreamHttpStatus(pollError);
                    String message = "场景切分轮询超时（超过 " + MAX_SCENE_SPLIT_POLLS
                            + " 次），上游持续错误: " + pollError.getMessage();
                    if (httpStatus != null) {
                        message = message.replaceAll(": HTTP " + httpStatus + "\\b", ":");
                    }
                    failClaimed(claim, VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED,
                            message, httpStatus);
                    return;
                }
                log.warn("[video_scene_split] 轮询瞬时错误 jobId={} pollCount={} err={}，重排继续轮询",
                        claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                boolean updated = stateMachine.rescheduleProviderPoll(
                        claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
                if (updated) {
                    scheduleNext(claim.id(), SCENE_SPLIT_POLL_INTERVAL_MS);
                }
                return;
            }
            throw pollError;
        }

        if ("processing".equals(observation.status())) {
            if (claim.pollCount() >= MAX_SCENE_SPLIT_POLLS) {
                failClaimed(claim, VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED,
                        "场景切分轮询超时（超过 " + MAX_SCENE_SPLIT_POLLS + " 次）");
                return;
            }
            boolean updated = stateMachine.rescheduleProviderPoll(
                    claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
            if (updated) {
                scheduleNext(claim.id(), SCENE_SPLIT_POLL_INTERVAL_MS);
            }
            return;
        }

        if ("failed".equals(observation.status())) {
            String message = observation.upstreamMessage() != null && !observation.upstreamMessage().isEmpty()
                    ? observation.upstreamMessage() : "场景切分任务失败";
            String code = classifyUpstreamFailure(observation.upstreamCode(), observation.upstreamMessage());
            log.info("[video_scene_split] 上游状态终态=failed jobId={} providerTaskId={} code={} pollCount={}",
                    claim.id(), claim.providerTaskId(), code, claim.pollCount());
            failClaimed(claim, code, message);
            return;
        }

        log.info("[video_scene_split] 上游状态终态=completed jobId={} providerTaskId={} pollCount={} segments={}",
                claim.id(), claim.providerTaskId(), claim.pollCount(),
                observation.segments() != null ? observation.segments().size() : 0);
        if (observation.segments() == null || observation.segments().isEmpty()) {
            failClaimed(claim, VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED,
                    "场景切分任务成功但未返回场景段");
            return;
        }
        publishResult(claim, observation);
    }

    private boolean publishResult(ClaimedJob claim,
                                  SceneSplitTaskObservation observation) {
        if (mediaRelay == null) {
            throw new VideoSceneSplitError(
                    VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED,
                    "场景切分转存存储未配置");
        }

        Integer width = null;
        Integer height = null;
        Double sourceDurationSec = null;
        String sourceAssetId = parseAssetId(
                claim.input().get(VideoSceneSplitContract.INPUT_KEY_SOURCE_ASSET_ID));
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
        Integer widthFinal = width;
        Integer heightFinal = height;

        List<SegmentObservation> observed = observation.segments();
        List<PublishVideoSceneSplitDto.Segment> segments = new ArrayList<>(observed.size());
        for (int i = 0; i < observed.size(); i++) {
            if (!renewLeaseForSegmentTransfer(claim, i, observed.size())) {
                return false;
            }
            SegmentObservation segment = observed.get(i);
            TosVideoMediaRelay.StoredVideo stored;
            try {
                stored = mediaRelay.persist(segment.segmentVideoUrl(), claim.userId());
            } catch (Exception e) {
                VideoSceneSplitError segmentFailure = new VideoSceneSplitError(
                        VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED,
                        "第 " + (i + 1) + " 段切片下载转存失败: " + e.getMessage());
                segmentFailure.initCause(e);
                throw segmentFailure;
            }
            segments.add(new PublishVideoSceneSplitDto.Segment(
                    i + 1,
                    segment.startTimeSec(),
                    segment.endTimeSec(),
                    stored.url(),
                    stored.storageKey(),
                    stored.mime(),
                    stored.size(),
                    stored.md5(),
                    widthFinal,
                    heightFinal));
        }
        log.info("[video_scene_split] 全段转存完成 jobId={} segments={} durationSec={}",
                claim.id(), segments.size(), durationSec);

        boolean published = finalizer.publishVideoSceneSplitResult(new PublishVideoSceneSplitDto(
                claim.id(),
                claim.projectId(),
                claim.userId(),
                claim.workerId(),
                claim.fencingToken(),
                durationSec,
                segments));
        if (published) {
            log.info("[video_scene_split] 发布成功 jobId={} assetSegments={}", claim.id(), segments.size());
        } else {
            log.warn("[video_scene_split] 终态失败(发布守卫未命中) jobId={}（stale worker 或已终态）",
                    claim.id());
        }
        return published;
    }

    private boolean renewLeaseForSegmentTransfer(
            ClaimedJob claim, int transferred, int total) {
        int progress = (int) Math.floor(transferred * 100.0 / total);
        try {
            boolean renewed = stateMachine.updateVideoSceneSplitProgress(
                    new UpdateVideoSceneSplitProgressDto(
                            claim.id(), claim.workerId(), claim.fencingToken(), progress));
            if (!renewed) {
                log.warn("[video_scene_split] 段转存续租未命中(已被接管/终态)，中止转存 jobId={} segment={}/{}",
                        claim.id(), transferred + 1, total);
            }
            return renewed;
        } catch (Exception e) {
            log.warn("[video_scene_split] 段转存续租 DB 异常，中止转存 jobId={}: {}",
                    claim.id(), e.getMessage(), e);
            return false;
        }
    }


    static boolean isTransientPollError(VideoSceneSplitError error) {
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
        if (e instanceof VideoSceneSplitError vss && PRESERVED_ERROR_CODES.contains(vss.getCode())) {
            return vss.getCode();
        }
        return VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED;
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
        return VideoSceneSplitContract.ERROR_VIDEO_SCENE_SPLIT_FAILED;
    }

    private void failClaimed(ClaimedJob claim, String code, String msg) {
        failClaimed(claim, code, msg, null);
    }

    private void failClaimed(ClaimedJob claim, String code, String msg,
                             Integer httpStatus) {
        log.warn("video_scene_split job 失败 jobId={} code={} message={}", claim.id(), code, msg);
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
            log.error("[video_scene_split] scheduleNext MQ 发送失败 jobId={} delayMs={}: {}",
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
