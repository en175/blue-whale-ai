package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.VideoMattingContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoMattingError;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class NewApiMediaKitMatteVideoClient {

    private final Map<String, EndpointClient> endpoints;

    public NewApiMediaKitMatteVideoClient(UpstreamBaseUrl baseUrl) {
        Map<String, EndpointClient> clients = new LinkedHashMap<>();
        for (String mode : VideoMattingContract.SUBMIT_PATHS.keySet()) {
            clients.put(mode, new EndpointClient(baseUrl, mode));
        }
        this.endpoints = Map.copyOf(clients);
    }

    public String submit(String token, String videoUrl, String mode, String format, String backgroundColor) {
        return endpointOf(mode).submit(token, videoUrl, format, backgroundColor);
    }

    public MatteVideoTaskObservation poll(String token, String taskId) {
        return endpoints.values().iterator().next().poll(token, taskId);
    }

    private EndpointClient endpointOf(String mode) {
        EndpointClient endpoint = endpoints.get(mode);
        if (endpoint == null) {
            throw new VideoMattingError(GenerationError.ERROR_INVALID_INPUT, "抠像模式非法: " + mode);
        }
        return endpoint;
    }

    static final class EndpointClient extends NewApiMediaKitAsyncTaskClient {

        private final String mode;

        EndpointClient(UpstreamBaseUrl baseUrl, String mode) {
            super(baseUrl);
            this.mode = mode;
        }

        @Override
        protected String submitPath() {
            return VideoMattingContract.SUBMIT_PATHS.get(mode);
        }

        @Override
        protected String pollPathPrefix() {
            return VideoMattingContract.POLL_PATH_PREFIX;
        }

        @Override
        protected String taskLabel() {
            return "智能抠像";
        }

        @Override
        protected String fallbackCode() {
            return VideoMattingContract.ERROR_VIDEO_MATTING_FAILED;
        }

        @Override
        protected RuntimeException error(String code, String message) {
            return new VideoMattingError(code, message);
        }

        String submit(String token, String videoUrl, String format, String backgroundColor) {
            if (!VideoMattingContract.SUPPORTED_FORMATS.contains(format)) {
                throw error(GenerationError.ERROR_INVALID_INPUT, "抠像输出格式非法: " + format);
            }
            if (!VideoMattingContract.FORMAT_MP4.equals(format) && backgroundColor != null) {
                throw error(GenerationError.ERROR_INVALID_INPUT, "WEBM 透明输出不接受 background_color");
            }

            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("model", VideoMattingContract.MODEL_NAMES.get(mode));
            payload.put(VideoMattingContract.SUBMIT_KEY_VIDEO_URL, videoUrl);
            payload.put(VideoMattingContract.SUBMIT_KEY_FORMAT, format);
            if (backgroundColor != null) {
                payload.put(VideoMattingContract.SUBMIT_KEY_BACKGROUND_COLOR, backgroundColor);
            }
            return executeSubmit(token, payload);
        }

        MatteVideoTaskObservation poll(String token, String taskId) {
            PollBody body = executePoll(token, taskId);
            String normalized = normalizedStatus(body);

            if ("failed".equals(normalized)) {
                return new MatteVideoTaskObservation("failed", null, null, null,
                        extractUpstreamCode(body), extractPollUpstreamMessage(body));
            }

            if ("completed".equals(normalized)) {
                JsonNode result = body.data().path("result");
                String videoUrl = NewApiMediaKitJsonSupport.textOrNull(result, "video_url");
                String resolution = NewApiMediaKitJsonSupport.textOrNull(result, "resolution");
                Double durationSec = result.path("duration").isNumber()
                        ? result.path("duration").asDouble() : null;
                return new MatteVideoTaskObservation("succeeded", videoUrl, resolution, durationSec,
                        null, null);
            }

            return new MatteVideoTaskObservation("processing", null, null, null, null, null);
        }
    }

    public record MatteVideoTaskObservation(
            String status,
            String videoUrl,
            String resolution,
            Double durationSec,
            String upstreamCode,
            String upstreamMessage
    ) implements ParentTaskObservation {}
}
