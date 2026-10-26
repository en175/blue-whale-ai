package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.AudioVideoMuxContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.MediaExtractError;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class NewApiMediaKitMuxAudioVideoClient extends NewApiMediaKitAsyncTaskClient {
    static final String MODEL = "mediakit-mux-audio-video";

    public NewApiMediaKitMuxAudioVideoClient(UpstreamBaseUrl baseUrl) { super(baseUrl); }

    @Override protected String submitPath() { return AudioVideoMuxContract.SUBMIT_PATH; }
    @Override protected String pollPathPrefix() { return AudioVideoMuxContract.POLL_PATH_PREFIX; }
    @Override protected String taskLabel() { return "音视频合成"; }
    @Override protected String fallbackCode() { return AudioVideoMuxContract.ERROR_AUDIO_VIDEO_MUX_FAILED; }
    @Override protected RuntimeException error(String code, String message) { return new MediaExtractError(code, message); }

    static Map<String, Object> submitPayload(String videoUrl, String audioUrl, boolean isAudioReserve,
                                             String sync, String clientToken) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("video_url", videoUrl);
        payload.put("audio_url", audioUrl);
        payload.put("is_audio_reserve", isAudioReserve);
        if (!"none".equals(sync)) {
            payload.put("is_video_audio_sync", true);
            payload.put("sync_mode", sync);
            payload.put("sync_method", "trim");
        }
        payload.put("client_token", clientToken);
        return payload;
    }

    public String submit(String token, String videoUrl, String audioUrl, boolean isAudioReserve,
                         String sync, String clientToken) {
        if (videoUrl == null || videoUrl.isBlank() || audioUrl == null || audioUrl.isBlank()
                || clientToken == null || clientToken.isBlank()
                || !AudioVideoMuxContract.SYNC_VALUES.contains(sync)) {
            throw error(GenerationError.ERROR_INVALID_INPUT, "音视频合成输入快照非法");
        }
        return executeSubmit(token, submitPayload(videoUrl, audioUrl, isAudioReserve, sync, clientToken));
    }

    public MuxAudioVideoTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String requestId = NewApiMediaKitJsonSupport.textOrNull(body.data(), "request_id");
        if (requestId == null) requestId = NewApiMediaKitJsonSupport.textOrNull(body.parsed(), "request_id");
        String status;
        try {
            status = normalizedStatus(body);
        } catch (MediaExtractError error) {
            if (requestId == null) throw error;
            throw new MediaExtractError(error.getCode(), error.getMessage() + " request_id=" + requestId, error);
        }
        if ("failed".equals(status)) {
            return new MuxAudioVideoTaskObservation("failed", null, null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body), requestId);
        }
        if ("completed".equals(status)) {
            JsonNode result = body.data().path("result");
            JsonNode videoUrl = result.path("video_url");
            JsonNode duration = result.path("duration");
            JsonNode resolution = result.path("resolution");
            return new MuxAudioVideoTaskObservation("succeeded",
                    videoUrl.isTextual() ? videoUrl.asText() : null,
                    duration.isNumber() ? duration.asDouble() : null,
                    resolution.isTextual() ? resolution.asText() : null,
                    null, null, requestId);
        }
        return new MuxAudioVideoTaskObservation("processing", null, null, null, null, null, requestId);
    }

    public record MuxAudioVideoTaskObservation(String status, String videoUrl, Double durationSec,
                                               String resolution, String upstreamCode,
                                               String upstreamMessage, String requestId) {
        public MuxAudioVideoTaskObservation(String status, String videoUrl, Double durationSec,
                                            String resolution, String upstreamCode, String upstreamMessage) {
            this(status, videoUrl, durationSec, resolution, upstreamCode, upstreamMessage, null);
        }
    }
}
