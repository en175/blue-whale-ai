package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.VideoFrameInterpolationContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoFrameInterpolationError;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class NewApiMediaKitInterpolateVideoClient extends NewApiMediaKitAsyncTaskClient {

    static final String MODEL = "mediakit-video-frame-interpolation";

    public NewApiMediaKitInterpolateVideoClient(UpstreamBaseUrl baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return VideoFrameInterpolationContract.SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return VideoFrameInterpolationContract.POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "视频插帧";
    }

    @Override
    protected String fallbackCode() {
        return VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new VideoFrameInterpolationError(code, message);
    }

    public String submit(String token, String videoUrl, int fps) {
        if (!VideoFrameInterpolationContract.SUPPORTED_FPS.contains(fps)) {
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "插帧目标帧率非法: " + fps);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("video_url", videoUrl);
        payload.put("fps", fps);
        return executeSubmit(token, payload);
    }

    public InterpolateVideoTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            return new InterpolateVideoTaskObservation("failed", null, null, null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            JsonNode result = body.data().path("result");
            JsonNode videoUrl = result.path(
                    VideoFrameInterpolationContract.RESULT_KEY_VIDEO_URL);
            JsonNode duration = result.path(
                    VideoFrameInterpolationContract.RESULT_KEY_DURATION);
            JsonNode resolution = result.path(
                    VideoFrameInterpolationContract.RESULT_KEY_RESOLUTION);
            JsonNode fps = result.path(VideoFrameInterpolationContract.RESULT_KEY_FPS);
            return new InterpolateVideoTaskObservation("succeeded",
                    videoUrl.isTextual() ? videoUrl.asText() : null,
                    duration.isNumber() ? duration.asDouble() : null,
                    resolution.isTextual() ? resolution.asText() : null,
                    fps.isNumber() ? fps.asDouble() : null,
                    null, null);
        }

        return new InterpolateVideoTaskObservation("processing", null, null, null, null, null, null);
    }

    public record InterpolateVideoTaskObservation(
            String status,
            String videoUrl,
            Double durationSec,
            String resolution,
            Double fps,
            String upstreamCode,
            String upstreamMessage
    ) implements ParentTaskObservation {}
}
