package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.MediaExtractContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.MediaExtractError;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class NewApiMediaKitExtractAudioClient extends NewApiMediaKitAsyncTaskClient {

    static final String MODEL = "mediakit-extract-audio";

    public NewApiMediaKitExtractAudioClient(UpstreamBaseUrl baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return MediaExtractContract.SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return MediaExtractContract.POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "音频提取";
    }

    @Override
    protected String fallbackCode() {
        return MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new MediaExtractError(code, message);
    }

    public String submit(String token, String videoUrl, String outputFormat) {
        if (outputFormat == null || !MediaExtractContract.SUPPORTED_OUTPUT_FORMATS.contains(outputFormat)) {
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "音频提取输出格式非法: " + outputFormat);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("video_url", videoUrl);
        payload.put("format", outputFormat);
        return executeSubmit(token, payload);
    }

    public ExtractAudioTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            return new ExtractAudioTaskObservation("failed", null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            JsonNode audioUrl = body.data().path("result").path("audio_url");
            JsonNode duration = body.data().path("result").path("duration");
            return new ExtractAudioTaskObservation("succeeded",
                    audioUrl.isTextual() ? audioUrl.asText() : null,
                    duration.isNumber() ? duration.asDouble() : null,
                    null, null);
        }

        return new ExtractAudioTaskObservation("processing", null, null, null, null);
    }

    public record ExtractAudioTaskObservation(
            String status,
            String audioUrl,
            Double durationSec,
            String upstreamCode,
            String upstreamMessage
    ) implements ParentTaskObservation {}
}
