package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.AudioTrimContract;
import com.bluewhale.worker.domain.error.AudioTrimError;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class NewApiMediaKitTrimAudioClient extends NewApiMediaKitAsyncTaskClient {

    static final String MODEL = "mediakit-trim-audio";

    public NewApiMediaKitTrimAudioClient(UpstreamBaseUrl baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return AudioTrimContract.SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return AudioTrimContract.POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "音频截取";
    }

    @Override
    protected String fallbackCode() {
        return AudioTrimContract.ERROR_AUDIO_TRIM_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new AudioTrimError(code, message);
    }

    public String submit(String token, String audioUrl, Double startTime, Double endTime,
                         String outputFormat) {
        if (outputFormat == null || !AudioTrimContract.SUPPORTED_OUTPUT_FORMATS.contains(outputFormat)) {
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "音频截取输出格式非法: " + outputFormat);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("audio_url", audioUrl);
        if (startTime != null) {
            payload.put("start_time", startTime);
        }
        if (endTime != null) {
            payload.put("end_time", endTime);
        }
        payload.put("format", outputFormat);
        return executeSubmit(token, payload);
    }

    public TrimAudioTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            return new TrimAudioTaskObservation("failed", null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            JsonNode result = body.data().path("result");
            JsonNode output = body.data().path("output");
            JsonNode audioUrl = result.hasNonNull("audio_url")
                    ? result.path("audio_url") : output.path("audio_url");
            JsonNode duration = result.hasNonNull("duration")
                    ? result.path("duration") : output.path("duration");
            return new TrimAudioTaskObservation("succeeded",
                    audioUrl.isTextual() ? audioUrl.asText() : null,
                    duration.isNumber() ? duration.asDouble() : null,
                    null, null);
        }

        return new TrimAudioTaskObservation("processing", null, null, null, null);
    }

    public record TrimAudioTaskObservation(
            String status,
            String audioUrl,
            Double durationSec,
            String upstreamCode,
            String upstreamMessage
    ) implements ParentTaskObservation {}
}
