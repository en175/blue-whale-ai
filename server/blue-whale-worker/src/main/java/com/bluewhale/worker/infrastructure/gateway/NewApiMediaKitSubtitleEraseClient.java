package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.VideoSubtitleEraseContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoSubtitleEraseError;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public class NewApiMediaKitSubtitleEraseClient extends NewApiMediaKitAsyncTaskClient {

    static final String SUBMIT_PATH = "/v1/mediakit/erase-video-subtitle-pro";

    static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

    static final String MODEL = "mediakit-erase-video-subtitle-pro";

    public NewApiMediaKitSubtitleEraseClient(UpstreamBaseUrl baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "去字幕";
    }

    @Override
    protected String fallbackCode() {
        return VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new VideoSubtitleEraseError(code, message);
    }

    public String submit(String token, String videoUrl, String detectMode,
                         List<Map<String, Object>> eraseBoxes) {
        String mode = VideoSubtitleEraseContract.MODE.get(detectMode);
        if (mode == null) {
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "去字幕检测模式非法: " + detectMode);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("video_url", videoUrl);
        payload.put("model_version", VideoSubtitleEraseContract.MODEL_VERSION);
        payload.put("mode", mode);
        payload.put("output_encode_mode", VideoSubtitleEraseContract.OUTPUT_ENCODE_MODE);
        if (eraseBoxes != null && !eraseBoxes.isEmpty()) {
            payload.put("erase_ratio_location", eraseBoxes);
        }
        return executeSubmit(token, payload);
    }

    public SubtitleEraseTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            return new SubtitleEraseTaskObservation("failed", null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            JsonNode videoUrl = body.data().path("result").path("video_url");
            JsonNode duration = body.data().path("result").path("duration");
            return new SubtitleEraseTaskObservation("succeeded",
                    videoUrl.isTextual() ? videoUrl.asText() : null,
                    duration.isNumber() ? duration.asDouble() : null,
                    null, null);
        }

        return new SubtitleEraseTaskObservation("processing", null, null, null, null);
    }

    public record SubtitleEraseTaskObservation(
            String status,
            String videoUrl,
            Double durationSec,
            String upstreamCode,
            String upstreamMessage
    ) implements ParentTaskObservation {}
}
