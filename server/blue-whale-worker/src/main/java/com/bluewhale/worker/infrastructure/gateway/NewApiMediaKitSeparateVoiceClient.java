package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.VocalSplitContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VocalSplitError;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;

@Component
public class NewApiMediaKitSeparateVoiceClient extends NewApiMediaKitAsyncTaskClient {

    static final String MODEL = "mediakit-separate-voice";

    private static final Map<String, String> TRACK_URL_KEYS = Map.of(
            "voice", "voice_audio_url",
            "background", "background_audio_url",
            "music", "music_audio_url",
            "sfx", "sfx_audio_url");

    public NewApiMediaKitSeparateVoiceClient(UpstreamBaseUrl baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return VocalSplitContract.SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return VocalSplitContract.POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "人声背景分离";
    }

    @Override
    protected String fallbackCode() {
        return VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new VocalSplitError(code, message);
    }

    public String submit(String token, String sourceUrl, boolean sourceIsVideo,
                         String scene, String outputFormat) {
        if (scene == null || !VocalSplitContract.SUPPORTED_SCENES.contains(scene)) {
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "人声背景分离场景非法: " + scene);
        }
        if (outputFormat == null || !VocalSplitContract.SUPPORTED_OUTPUT_FORMATS.contains(outputFormat)) {
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "人声背景分离输出格式非法: " + outputFormat);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put(sourceIsVideo ? "video_url" : "audio_url", sourceUrl);
        payload.put("scene", VocalSplitContract.SCENE_UPSTREAM_MAP.get(scene));
        payload.put("output_format", outputFormat);
        return executeSubmit(token, payload);
    }

    public SeparateVoiceTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            return new SeparateVoiceTaskObservation("failed", null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            JsonNode result = body.data().path("result");
            Map<String, String> trackUrls = new TreeMap<>();
            for (Map.Entry<String, String> entry : TRACK_URL_KEYS.entrySet()) {
                JsonNode urlNode = result.get(entry.getValue());
                if (urlNode != null && urlNode.isTextual() && !urlNode.asText().isEmpty()) {
                    trackUrls.put(entry.getKey(), urlNode.asText());
                }
            }
            JsonNode duration = result.get("duration");
            return new SeparateVoiceTaskObservation("succeeded",
                    trackUrls,
                    duration != null && duration.isNumber() ? duration.asDouble() : null,
                    null, null);
        }

        return new SeparateVoiceTaskObservation("processing", null, null, null, null);
    }

    public record SeparateVoiceTaskObservation(
            String status,
            Map<String, String> trackUrls,
            Double durationSec,
            String upstreamCode,
            String upstreamMessage
    ) implements ParentTaskObservation {}
}
