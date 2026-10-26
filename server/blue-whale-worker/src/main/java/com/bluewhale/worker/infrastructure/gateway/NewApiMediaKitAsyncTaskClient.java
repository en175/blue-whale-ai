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

import java.net.SocketTimeoutException;
import java.util.Map;
import java.util.UUID;

import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.JSON;
import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.JSON_TYPE;
import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.encodePath;
import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.extractUpstreamMessage;
import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.truncate;
import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.unwrapData;

abstract class NewApiMediaKitAsyncTaskClient {

    private static final int SUBMIT_TIMEOUT_MS = 30_000;

    private static final int POLL_TIMEOUT_MS = 10_000;

    protected final String baseUrl;
    private final OkHttpClient submitClient;
    private final OkHttpClient pollClient;

    protected NewApiMediaKitAsyncTaskClient(UpstreamBaseUrl baseUrl) {
        this.baseUrl = baseUrl.normalized();
        this.submitClient = NewApiHttpSupport.buildClient(10_000, SUBMIT_TIMEOUT_MS, SUBMIT_TIMEOUT_MS);
        this.pollClient = NewApiHttpSupport.buildClient(10_000, POLL_TIMEOUT_MS, POLL_TIMEOUT_MS);
    }


    protected abstract String submitPath();

    protected abstract String pollPathPrefix();

    protected abstract String taskLabel();

    protected abstract String fallbackCode();

    protected abstract RuntimeException error(String code, String message);


    protected String executeSubmit(String token, Map<String, Object> payload) {
        String traceId = UUID.randomUUID().toString();
        String label = taskLabel();

        String bodyJson;
        try {
            bodyJson = JSON.writeValueAsString(payload);
        } catch (Exception e) {
            throw error(fallbackCode(), "请求序列化失败");
        }

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + submitPath())
                .post(RequestBody.create(bodyJson, JSON_TYPE))
                .header("Content-Type", "application/json");
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        Request request = requestBuilder.build();

        Response response;
        try {
            response = submitClient.newCall(request).execute();
        } catch (SocketTimeoutException e) {
            throw error(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "MediaKit " + label + "提交超时");
        } catch (Exception e) {
            throw error(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit " + label + "提交失败: " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }

        try (response) {
            ResponseBody body = response.body();
            String rawText = body != null ? body.string() : "";

            if (!response.isSuccessful()) {
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                String reason = extractUpstreamMessage(rawText);
                String message = label + "任务提交失败: HTTP " + response.code();
                if (!reason.isEmpty()) {
                    message += " " + reason;
                } else {
                    message += " body=" + truncate(rawText);
                }
                message += requestIdSuffix(rawText);
                RuntimeException error = error(code, message);
                error.initCause(new NewApiVideoClient.HttpStatusException(response.code()));
                throw error;
            }

            JsonNode parsed = parseJsonOrThrow(rawText);

            JsonNode errorNode = parsed.get("error");
            if (errorNode != null && errorNode.has("message")) {
                String errText = errorNode.get("message").asText();
                String code = NewApiErrorClassifier.classifySuccessEnvelope(errText);
                throw error(code, "MediaKit " + label + "提交业务失败: " + truncate(errText)
                        + requestIdSuffix(rawText));
            }

            JsonNode data = unwrapData(parsed);
            String taskId = NewApiMediaKitJsonSupport.textOrNull(data, "task_id");
            if (taskId == null || taskId.isEmpty()) {
                throw error(fallbackCode(),
                        "MediaKit " + label + "提交响应缺少 task_id" + requestIdSuffix(rawText));
            }
            return taskId;
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw error(fallbackCode(),
                    "MediaKit " + label + "提交响应读取失败: " + e.getMessage());
        }
    }


    protected record PollBody(JsonNode parsed, JsonNode data) {}

    protected PollBody executePoll(String token, String taskId) {
        String traceId = UUID.randomUUID().toString();
        String label = taskLabel();

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + pollPathPrefix() + encodePath(taskId))
                .get();
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        Request request = requestBuilder.build();

        Response response;
        try {
            response = pollClient.newCall(request).execute();
        } catch (SocketTimeoutException e) {
            throw error(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "MediaKit " + label + "任务查询超时");
        } catch (java.net.ConnectException | java.net.UnknownHostException e) {
            RuntimeException error = error(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit " + label + "任务查询网络不可达");
            error.initCause(e);
            throw error;
        } catch (Exception e) {
            throw error(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit " + label + "任务查询失败: " + e.getMessage());
        }

        try (response) {
            ResponseBody body = response.body();
            String rawText = body != null ? body.string() : "";

            if (!response.isSuccessful()) {
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                RuntimeException error = error(code,
                        "MediaKit " + label + "任务查询失败: HTTP " + response.code() + " body=" + truncate(rawText)
                                + requestIdSuffix(rawText));
                error.initCause(new NewApiVideoClient.HttpStatusException(response.code()));
                throw error;
            }

            JsonNode parsed = parseJsonOrThrow(rawText);
            return new PollBody(parsed, unwrapData(parsed));
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw error(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit " + label + "任务响应解析失败: " + e.getMessage());
        }
    }

    protected String normalizedStatus(PollBody body) {
        String status = NewApiMediaKitJsonSupport.textOrNull(body.data(), "status");
        if (status == null) {
            throw error(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit " + taskLabel() + "任务响应缺少 status");
        }
        return status.toLowerCase();
    }

    protected String extractUpstreamCode(PollBody body) {
        JsonNode rawError = body.data().has("error") && body.data().get("error").isObject()
                ? body.data().get("error") : body.parsed().get("error");
        return rawError != null && rawError.has("code")
                ? rawError.get("code").asText() : null;
    }

    protected String extractPollUpstreamMessage(PollBody body) {
        for (JsonNode node : new JsonNode[] {body.data(), body.parsed()}) {
            JsonNode message = node.path("error").path("message");
            if (!message.isTextual() || message.asText().isEmpty()) {
                message = node.path("message");
            }
            if (message.isTextual() && !message.asText().isEmpty()) {
                String requestId = NewApiMediaKitJsonSupport.textOrNull(body.data(), "request_id");
                if (requestId == null) requestId = NewApiMediaKitJsonSupport.textOrNull(body.parsed(), "request_id");
                return truncate(message.asText()) + (requestId != null ? " request_id=" + requestId : "");
            }
        }
        return "";
    }

    private static String requestIdSuffix(String rawText) {
        try {
            String requestId = NewApiMediaKitJsonSupport.textOrNull(JSON.readTree(rawText), "request_id");
            return requestId != null ? " request_id=" + requestId : "";
        } catch (Exception ignored) {
            return "";
        }
    }


    protected JsonNode parseJsonOrThrow(String rawText) {
        try {
            return JSON.readTree(rawText);
        } catch (Exception e) {
            throw error(fallbackCode(), "MediaKit 未返回有效 JSON");
        }
    }
}
