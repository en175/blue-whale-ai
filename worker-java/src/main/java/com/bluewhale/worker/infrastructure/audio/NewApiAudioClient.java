package com.bluewhale.worker.infrastructure.audio;

import com.bluewhale.worker.domain.error.AudioProviderError;
import com.bluewhale.worker.domain.error.GenerationError;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * new-api 音频 TTS 客户端（new-api-audio-provider.ts:55-190 逐字移植）。
 * <p>
 * 端点：POST /v1/audio/speech（契约 §5）。
 * <p>
 * 请求头（契约 §5 / ADR-0080）：
 * <ul>
 *   <li>Authorization: Bearer &lt;per-job 解封凭证&gt;</li>
 *   <li>X-Trace-Id：请求追踪</li>
 *   <li>X-Client-System: bluewhale（ADR-0080 白名单头，缺了网关登录隔离会破）</li>
 *   <li>Content-Type: application/json</li>
 * </ul>
 * <p>
 * 错误分类优先级（§5 / IKDAJN）：content > quota > provider_failed。
 * 中文正则与 TS 逐字一致（error-codes.ts isContentPolicySignal / isQuotaSignal）。
 */
@Component
public class NewApiAudioClient {

    private static final Logger log = LoggerFactory.getLogger(NewApiAudioClient.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final MediaType JSON_TYPE = MediaType.get("application/json");

    /** 默认超时 30s（new-api-audio-provider.ts:42 DEFAULT_AUDIO_TIMEOUT_MS）。 */
    private static final int DEFAULT_TIMEOUT_MS = 30_000;

    /**
     * 内容策略正则（error-codes.ts isContentPolicySignal）。
     * 与 TS 逐字一致：/(copyright|sensitive|版权|敏感|policy violation|policyviolation|content policy)/i
     */
    private static final Pattern CONTENT_POLICY_PATTERN = Pattern.compile(
            "copyright|sensitive|版权|敏感|policy violation|policyviolation|content policy",
            Pattern.CASE_INSENSITIVE
    );

    /**
     * 额度信号正则（error-codes.ts isQuotaSignal）。
     * 与 TS 逐字一致：/(预扣费额度失败|剩余额度|余额不足|额度不足|balance|payment_required)/i
     */
    private static final Pattern QUOTA_PATTERN = Pattern.compile(
            "预扣费额度失败|剩余额度|余额不足|额度不足|balance|payment_required",
            Pattern.CASE_INSENSITIVE
    );

    private final OkHttpClient httpClient;
    private final String baseUrl;

    public NewApiAudioClient() {
        this(System.getenv("NEW_API_BASE_URL"));
    }

    /** 测试用构造器：注入 base URL。 */
    NewApiAudioClient(String baseUrl) {
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalStateException("NEW_API_BASE_URL 未配置");
        }
        // 去尾斜杠（new-api-audio-provider.ts:58）
        this.baseUrl = baseUrl.replaceAll("/+$", "");

        int timeoutMs = loadTimeoutMs();
        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .build();
    }

    /**
     * 音频生成（new-api-audio-provider.ts:70-188 逐字移植）。
     * <p>
     * 请求 body：model + text_prompt + audio_config + watermark + references（可选）。
     * 响应：{audio: base64} | {url: string}；duration 可选。
     *
     * @return 生成结果（data/url/duration/requestId）
     * @throws AudioProviderError 按错误分类抛错
     */
    public AudioResult generate(String token, String modelId, String prompt,
                                List<Map<String, String>> references) {
        // 构建请求 body（new-api-audio-provider.ts:75-89）
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

        // 请求头（契约 §5 / ADR-0080）
        Request request = new Request.Builder()
                .url(baseUrl + "/v1/audio/speech")
                .post(RequestBody.create(bodyJson, JSON_TYPE))
                .header("Authorization", "Bearer " + token)
                .header("X-Trace-Id", traceId)
                .header("X-Client-System", "bluewhale") // ADR-0080 白名单头
                .header("Content-Type", "application/json")
                .build();

        Response response;
        try {
            response = httpClient.newCall(request).execute();
        } catch (java.net.SocketTimeoutException e) {
            // new-api-audio-provider.ts:100-104：超时 → provider_timeout
            throw new AudioProviderError(GenerationError.ERROR_PROVIDER_TIMEOUT, "new-api 音频生成超时");
        } catch (Exception e) {
            throw new AudioProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 音频生成失败: " + e.getMessage());
        }

        try (response) {
            // 提取 X-Oneapi-Request-Id（契约 §5：receipt 取证）
            String requestId = response.header("X-Oneapi-Request-Id");

            ResponseBody body = response.body();
            String rawText = body != null ? body.string() : "";

            // 非 2xx → 分类（new-api-audio-provider.ts:119-130）
            if (!response.isSuccessful()) {
                String code = classifyError(rawText, response.code());
                String truncated = rawText.length() > 300 ? rawText.substring(0, 300) + "…" : rawText;
                throw new AudioProviderError(code,
                        "new-api 音频生成失败: HTTP " + response.code() + " body=" + truncated);
            }

            // 解析 JSON（new-api-audio-provider.ts:132-168）
            JsonNode parsed;
            try {
                parsed = JSON.readTree(rawText);
            } catch (Exception e) {
                // 成功态非 JSON → no_result（new-api-audio-provider.ts:140）
                throw new AudioProviderError(GenerationError.ERROR_NO_RESULT,
                        "生成服务未返回有效 JSON");
            }

            // 成功态错误信封（new-api-audio-provider.ts:142-163）
            JsonNode errorNode = parsed.get("error");
            if (errorNode != null && errorNode.has("message")) {
                String errText = errorNode.get("message").asText();
                // IKDAJN：版权/敏感优先于 quota
                if (isContentPolicySignal(errText)) {
                    throw new AudioProviderError(GenerationError.ERROR_CONTENT_REJECTED,
                            "生成内容涉及版权或敏感信息");
                }
                if (isQuotaSignal(errText)) {
                    throw new AudioProviderError(GenerationError.ERROR_QUOTA_EXHAUSTED,
                            "new-api 音频生成余额不足");
                }
                throw new AudioProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "new-api 音频生成业务失败");
            }

            // 提取结果（new-api-audio-provider.ts:169-186）
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

    /**
     * 非 2xx 错误分类（new-api-audio-provider.ts:119-130 + §5 IKDAJN）。
     * 优先级：content > quota > provider_failed。
     */
    String classifyError(String text, int httpStatus) {
        // HTTP 402 → quota（§5：额度 HTTP 402）
        if (isContentPolicySignal(text)) {
            return GenerationError.ERROR_CONTENT_REJECTED;
        }
        if (httpStatus == 402 || isQuotaSignal(text)) {
            return GenerationError.ERROR_QUOTA_EXHAUSTED;
        }
        return GenerationError.ERROR_PROVIDER_FAILED;
    }

    static boolean isContentPolicySignal(String text) {
        return text != null && CONTENT_POLICY_PATTERN.matcher(text).find();
    }

    static boolean isQuotaSignal(String text) {
        return text != null && QUOTA_PATTERN.matcher(text).find();
    }

    private int loadTimeoutMs() {
        String raw = System.getenv("NEW_API_AUDIO_TIMEOUT_MS");
        if (raw != null) {
            try {
                int n = Integer.parseInt(raw);
                if (n > 0) return n;
            } catch (NumberFormatException e) {
                log.debug("NEW_API_AUDIO_TIMEOUT_MS 解析失败，使用默认值: {}", e.getMessage());
            }
        }
        return DEFAULT_TIMEOUT_MS;
    }

    /**
     * 音频生成结果（对齐 TS GeneratedAudio）。
     *
     * @param data      base64 解码后的音频字节（data-direct 路径；可能为 null 如果 url 非空）
     * @param url       音频 URL（可能为 null 如果 data 非空）
     * @param mime      MIME（恒 audio/mpeg）
     * @param duration  时长（秒，可选）
     * @param requestId X-Oneapi-Request-Id（receipt 取证，可选）
     */
    public record AudioResult(
            byte[] data,
            String url,
            String mime,
            Double duration,
            String requestId
    ) {}
}
