package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.VideoEnhanceContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoEnhanceError;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class NewApiMediaKitEnhanceVideoClient extends NewApiMediaKitAsyncTaskClient {

    static final String MODEL = "mediakit-enhance-video-generative";

    public NewApiMediaKitEnhanceVideoClient(UpstreamBaseUrl baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return VideoEnhanceContract.SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return VideoEnhanceContract.POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "画质增强";
    }

    @Override
    protected String fallbackCode() {
        return VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new VideoEnhanceError(code, message);
    }

    public String submit(String token, String videoUrl, String resolution) {
        if (resolution == null || !VideoEnhanceContract.SUPPORTED_RESOLUTIONS.contains(resolution)) {
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "画质增强目标分辨率非法: " + resolution);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("video_url", videoUrl);
        payload.put("resolution", resolution);
        payload.put("bitrate_level", VideoEnhanceContract.BITRATE_LEVEL);
        return executeSubmit(token, payload);
    }

    public EnhanceVideoTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            return new EnhanceVideoTaskObservation("failed", null, null, null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            JsonNode videoUrl = body.data().path("result").path("video_url");
            JsonNode duration = body.data().path("result").path("duration");
            JsonNode resolution = body.data().path("result").path("resolution");
            JsonNode fps = body.data().path("result").path("fps");
            return new EnhanceVideoTaskObservation("succeeded",
                    videoUrl.isTextual() ? videoUrl.asText() : null,
                    duration.isNumber() ? duration.asDouble() : null,
                    resolution.isTextual() ? resolution.asText() : null,
                    fps.isNumber() ? fps.asDouble() : null,
                    null, null);
        }

        return new EnhanceVideoTaskObservation("processing", null, null, null, null, null, null);
    }

    public record EnhanceVideoTaskObservation(
            String status,
            String videoUrl,
            Double durationSec,
            String resolution,
            Double fps,
            String upstreamCode,
            String upstreamMessage
    ) implements ParentTaskObservation {}
}
