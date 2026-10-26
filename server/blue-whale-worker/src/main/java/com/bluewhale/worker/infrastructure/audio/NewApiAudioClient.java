package com.bluewhale.worker.infrastructure.audio;

import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.error.AudioProviderError;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.springframework.stereotype.Component;

import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

@Component
public class NewApiAudioClient {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final MediaType JSON_TYPE = MediaType.get("application/json");

    private static final int DEFAULT_TIMEOUT_MS = 90_000;

    private final OkHttpClient httpClient;
    private final String baseUrl;

    public NewApiAudioClient(UpstreamBaseUrl baseUrl) {
        this.baseUrl = baseUrl.normalized();

        int timeoutMs = loadTimeoutMs();
        this.httpClient = com.bluewhale.common.http.NewApiHttpSupport.buildClient(10_000, timeoutMs, timeoutMs);
    }

    public AudioResult generate(String token, String modelId, String prompt,
                                List<Map<String, String>> references) {
        Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("model", modelId);
        payload.put("text_prompt", prompt);
        payload.put("audio_config", Map.of(
                "format", "mp3",
                "sample_rate", 48000,
                "pitch_rate", 0,
                "speech_rate", 0,
                "loudness_rate", 0
        ));
        payload.put("watermark", Map.of());
        if (references != null && !references.isEmpty()) {
            payload.put("references", references);
        }

        String traceId = UUID.randomUUID().toString();
        String bodyJson;
        try {
            bodyJson = JSON.writeValueAsString(payload);
        } catch (Exception e) {
            throw new AudioProviderError(GenerationError.ERROR_PROVIDER_FAILED, "请求序列化失败");
        }

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + "/v1/audio/speech")
                .post(RequestBody.create(bodyJson, JSON_TYPE))
                .header("Content-Type", "application/json");
        com.bluewhale.common.http.NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        Request request = requestBuilder.build();

        Response response;
        try {
            response = httpClient.newCall(request).execute();
        } catch (java.net.SocketTimeoutException e) {
            throw new AudioProviderError(GenerationError.ERROR_PROVIDER_TIMEOUT, "new-api 音频生成超时");
        } catch (Exception e) {
            throw new AudioProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 音频生成失败: " + e.getMessage());
        }

        try (response) {
            String requestId = response.header("X-Oneapi-Request-Id");

            ResponseBody body = response.body();
            String rawText = body != null ? body.string() : "";

            if (!response.isSuccessful()) {
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                String truncated = rawText.length() > 300 ? rawText.substring(0, 300) + "…" : rawText;
                throw new AudioProviderError(code,
                        "new-api 音频生成失败: HTTP " + response.code() + " body=" + truncated);
            }

            JsonNode parsed;
            try {
                parsed = JSON.readTree(rawText);
            } catch (Exception e) {
                throw new AudioProviderError(GenerationError.ERROR_NO_RESULT,
                        "生成服务未返回有效 JSON");
            }

            JsonNode errorNode = parsed.get("error");
            if (errorNode != null && errorNode.has("message")) {
                String errText = errorNode.get("message").asText();
                String code = NewApiErrorClassifier.classifySuccessEnvelope(errText);
                String message = switch (code) {
                    case GenerationError.ERROR_CONTENT_REJECTED -> "生成内容涉及版权或敏感信息";
                    case GenerationError.ERROR_PLATFORM_QUOTA_EXHAUSTED -> "new-api 音频生成余额不足";
                    default -> "new-api 音频生成业务失败";
                };
                throw new AudioProviderError(code, message);
            }

            byte[] data = null;
            String url = null;
            Double duration = null;

            JsonNode audioNode = parsed.get("audio");
            if (audioNode != null && audioNode.isTextual() && !audioNode.asText().isEmpty()) {
                data = Base64.getDecoder().decode(audioNode.asText());
            }
            JsonNode urlNode = parsed.get("url");
            if (urlNode != null && urlNode.isTextual()) {
                url = urlNode.asText();
            }
            if (data == null && url == null) {
                throw new AudioProviderError(GenerationError.ERROR_NO_RESULT,
                        "生成服务未返回音频结果");
            }
            JsonNode durationNode = parsed.get("duration");
            if (durationNode != null && durationNode.isNumber()) {
                duration = durationNode.asDouble();
            }

            return new AudioResult(data, url, "audio/mpeg", duration, requestId);
        } catch (AudioProviderError e) {
            throw e;
        } catch (Exception e) {
            throw new AudioProviderError(GenerationError.ERROR_NO_RESULT,
                    "生成服务未返回有效 JSON");
        }
    }

    private int loadTimeoutMs() {
        return NewApiUpstreamConfig.timeoutMs("NEW_API_AUDIO_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
    }

    public record AudioResult(
            byte[] data,
            String url,
            String mime,
            Double duration,
            String requestId
    ) {}
}
