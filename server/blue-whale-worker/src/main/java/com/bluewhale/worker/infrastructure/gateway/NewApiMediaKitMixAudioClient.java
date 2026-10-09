package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.AudioMixContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.MediaExtractError;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public class NewApiMediaKitMixAudioClient extends NewApiMediaKitAsyncTaskClient {
    static final String MODEL = "mediakit-mix-audio";

    public NewApiMediaKitMixAudioClient(UpstreamBaseUrl baseUrl) { super(baseUrl); }

    @Override protected String submitPath() { return AudioMixContract.SUBMIT_PATH; }
    @Override protected String pollPathPrefix() { return AudioMixContract.POLL_PATH_PREFIX; }
    @Override protected String taskLabel() { return "音频混合"; }
    @Override protected String fallbackCode() { return AudioMixContract.ERROR_AUDIO_MIX_FAILED; }
    @Override protected RuntimeException error(String code, String message) { return new MediaExtractError(code, message); }

    public String submit(String token, List<String> audioUrls, String outputFormat) {
        if (audioUrls == null || audioUrls.size() < 2 || audioUrls.size() > 100
                || audioUrls.stream().anyMatch(url -> url == null || url.isBlank())) {
            throw error(GenerationError.ERROR_INVALID_INPUT, "音频混合输入须为 2–100 段有效音频");
        }
        if (!AudioMixContract.SUPPORTED_OUTPUT_FORMATS.contains(outputFormat)) {
            throw error(GenerationError.ERROR_INVALID_INPUT, "音频混合输出格式非法");
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("audio_urls", audioUrls);
        payload.put("format", outputFormat);
        return executeSubmit(token, payload);
    }

    public MixAudioTaskObservation poll(String token, String taskId) {
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
            return new MixAudioTaskObservation("failed", null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body), requestId);
        }
        if ("completed".equals(status)) {
            JsonNode result = body.data().path("result");
            JsonNode audioUrl = result.path("audio_url");
            JsonNode duration = result.path("duration");
            return new MixAudioTaskObservation("succeeded",
                    audioUrl.isTextual() ? audioUrl.asText() : null,
                    duration.isNumber() ? duration.asDouble() : null, null, null, requestId);
        }
        return new MixAudioTaskObservation("processing", null, null, null, null, requestId);
    }

    public record MixAudioTaskObservation(String status, String audioUrl, Double durationSec,
                                          String upstreamCode, String upstreamMessage, String requestId) {
        public MixAudioTaskObservation(String status, String audioUrl, Double durationSec,
                                       String upstreamCode, String upstreamMessage) {
            this(status, audioUrl, durationSec, upstreamCode, upstreamMessage, null);
        }
    }
}
