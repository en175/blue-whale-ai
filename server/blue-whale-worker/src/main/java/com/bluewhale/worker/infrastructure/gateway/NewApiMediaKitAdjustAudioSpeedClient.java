package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.AudioSpeedContract;
import com.bluewhale.worker.domain.error.AudioSpeedError;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class NewApiMediaKitAdjustAudioSpeedClient extends NewApiMediaKitAsyncTaskClient {

    static final String MODEL = "mediakit-adjust-audio-speed";

    public NewApiMediaKitAdjustAudioSpeedClient(UpstreamBaseUrl baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return AudioSpeedContract.SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return AudioSpeedContract.POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "音频调速";
    }

    @Override
    protected String fallbackCode() {
        return AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new AudioSpeedError(code, message);
    }

    public String submit(String token, String audioUrl, Double speed) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("audio_url", audioUrl);
        if (speed != null) {
            payload.put("speed", speed);
        }
        return executeSubmit(token, payload);
    }

    public AudioSpeedTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            return new AudioSpeedTaskObservation("failed", null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            JsonNode result = body.data().path("result");
            JsonNode output = body.data().path("output");
            JsonNode audioUrl = result.hasNonNull("audio_url")
                    ? result.path("audio_url") : output.path("audio_url");
            JsonNode duration = result.hasNonNull("duration")
                    ? result.path("duration") : output.path("duration");
            return new AudioSpeedTaskObservation("succeeded",
                    audioUrl.isTextual() ? audioUrl.asText() : null,
                    duration.isNumber() ? duration.asDouble() : null,
                    null, null);
        }

        return new AudioSpeedTaskObservation("processing", null, null, null, null);
    }

    public record AudioSpeedTaskObservation(
            String status,
            String audioUrl,
            Double durationSec,
            String upstreamCode,
            String upstreamMessage
    ) {}
}
