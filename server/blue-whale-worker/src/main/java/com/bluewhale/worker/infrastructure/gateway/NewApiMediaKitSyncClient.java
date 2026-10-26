package com.bluewhale.worker.infrastructure.gateway;
import com.bluewhale.common.http.NewApiHttpSupport;

import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.error.GenerationError;
import com.fasterxml.jackson.databind.JsonNode;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

import java.util.Map;
import java.util.UUID;

import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.JSON;
import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.JSON_TYPE;
import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.extractUpstreamMessage;
import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.truncate;

abstract class NewApiMediaKitSyncClient {

    protected final String baseUrl;
    private final OkHttpClient httpClient;

    protected NewApiMediaKitSyncClient(UpstreamBaseUrl baseUrl, int timeoutMs) {
        this.baseUrl = baseUrl.normalized();
        this.httpClient = NewApiHttpSupport.buildClient(10_000, timeoutMs, timeoutMs);
    }


    protected abstract String syncPath();

    protected abstract String taskLabel();

    protected abstract String fallbackCode();

    protected abstract RuntimeException error(String code, String message);


    protected JsonNode executeSyncPost(String token, Map<String, Object> payload) {
        String traceId = UUID.randomUUID().toString();
        String label = taskLabel();

        Request.Builder requestBuilder;
        try {
            requestBuilder = new Request.Builder()
                    .url(baseUrl + syncPath())
                    .post(RequestBody.create(JSON.writeValueAsString(payload), JSON_TYPE))
                    .header("Content-Type", "application/json");
        } catch (Exception e) {
            throw error(fallbackCode(), "请求序列化失败");
        }
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        Request request = requestBuilder.build();

        Response response;
        try {
            response = httpClient.newCall(request).execute();
        } catch (java.net.SocketTimeoutException e) {
            throw error(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "MediaKit " + label + "超时");
        } catch (Exception e) {
            throw error(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit " + label + "调用失败: " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }

        try (response) {
            ResponseBody body = response.body();
            String rawText = body != null ? body.string() : "";

            if (!response.isSuccessful()) {
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                String reason = extractUpstreamMessage(rawText);
                String message = label + "失败: HTTP " + response.code();
                if (!reason.isEmpty()) {
                    message += " " + reason;
                } else {
                    message += " body=" + truncate(rawText);
                }
                throw error(code, message);
            }

            JsonNode parsed = parseJsonOrThrow(rawText);

            JsonNode errorNode = parsed.get("error");
            if (errorNode != null && errorNode.has("message")) {
                String errText = errorNode.get("message").asText();
                String code = NewApiErrorClassifier.classifySuccessEnvelope(errText);
                throw error(code, "MediaKit " + label + "业务失败: " + truncate(errText));
            }
            return parsed;
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw error(fallbackCode(),
                    "MediaKit 响应读取失败: " + e.getMessage());
        }
    }

    protected String requireResultImageUrl(JsonNode parsed) {
        JsonNode resultUrl = parsed.path("result").path("image_url");
        if (!resultUrl.isTextual() || resultUrl.asText().isEmpty()) {
            throw error(fallbackCode(), "MediaKit 未返回结果图");
        }
        return resultUrl.asText();
    }


    protected JsonNode parseJsonOrThrow(String rawText) {
        try {
            return JSON.readTree(rawText);
        } catch (Exception e) {
            throw error(fallbackCode(), "MediaKit 未返回有效 JSON");
        }
    }
}
