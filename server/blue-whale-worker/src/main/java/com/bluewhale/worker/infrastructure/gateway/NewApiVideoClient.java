package com.bluewhale.worker.infrastructure.gateway;
import com.bluewhale.common.http.NewApiHttpSupport;

import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.infrastructure.config.GenerationWatermarkConfig.GenerationWatermarkPolicy;
import com.bluewhale.worker.domain.contract.VideoSampleContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoProviderError;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.SocketTimeoutException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

public class NewApiVideoClient {

    private static final Logger log = LoggerFactory.getLogger(NewApiVideoClient.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final MediaType JSON_TYPE = MediaType.get("application/json");

    private static final int SUBMIT_TIMEOUT_MS = 120_000;
    private static final int POLL_TIMEOUT_MS = 10_000;

    private static final Map<String, Boolean> SUCCESS_STATUSES = Map.of(
            "success", true, "succeeded", true, "completed", true);
    private static final Map<String, Boolean> FAILED_STATUSES = Map.of(
            "failed", true, "failure", true, "error", true,
            "cancelled", true, "canceled", true);

    private final OkHttpClient submitClient;
    private final OkHttpClient pollClient;
    private final String baseUrl;
    private final GenerationWatermarkPolicy watermarkPolicy;

    public NewApiVideoClient(UpstreamBaseUrl baseUrl) {
        this(baseUrl, GenerationWatermarkPolicy.disabled());
    }

    public NewApiVideoClient(UpstreamBaseUrl baseUrl, GenerationWatermarkPolicy watermarkPolicy) {
        this.baseUrl = baseUrl.normalized();
        this.watermarkPolicy = watermarkPolicy;
        this.submitClient = NewApiHttpSupport.buildClient(10_000, SUBMIT_TIMEOUT_MS, SUBMIT_TIMEOUT_MS);
        this.pollClient = NewApiHttpSupport.buildClient(10_000, POLL_TIMEOUT_MS, POLL_TIMEOUT_MS);
    }

    public SubmitResult submit(String token, VideoSubmitInput input) {
        String traceId = UUID.randomUUID().toString();

        ArrayNode content = JSON.createArrayNode();
        if (input.firstFrameImage() != null) {
            content.add(buildContentItem("image_url", input.firstFrameImage(), "first_frame"));
        }
        if (input.lastFrameImage() != null) {
            content.add(buildContentItem("image_url", input.lastFrameImage(), "last_frame"));
        }
        for (VideoReference ref : input.references()) {
            String typeKey = switch (ref.type()) {
                case "image" -> "image_url";
                case "audio" -> "audio_url";
                default -> "video_url";
            };
            String role = ref.role() != null ? ref.role() : switch (ref.type()) {
                case "image" -> "reference_image";
                case "audio" -> "reference_audio";
                default -> "reference_video";
            };
            content.add(buildContentItem(typeKey, ref.url(), role));
        }

        String omniTaskType = null;
        if (input.omniTaskTypeAllowed() && hasVideoReference(input.references())) {
            omniTaskType = switch (input.videoTaskType() == null ? "text2video" : input.videoTaskType()) {
                case "edit" -> "edit";
                case "extend" -> "extend";
                case "first_frame", "first_last_frame" -> null;
                default -> "reference";
            };
        }
        double effectiveDuration = input.duration();
        String effectiveRatio = input.ratio();

        ObjectNode metadata = JSON.createObjectNode();
        metadata.put("duration", effectiveDuration);
        if (input.resolution() != null) metadata.put("resolution", input.resolution());
        if (effectiveRatio != null) metadata.put("ratio", effectiveRatio);
        if (omniTaskType != null) metadata.put("omni_reference_task_type", omniTaskType);
        if (input.generateAudio() != null) metadata.put("generate_audio", input.generateAudio());
        metadata.put("watermark", watermarkPolicy.enabled());
        metadata.set("content", content);

        ObjectNode body = JSON.createObjectNode();
        body.put("model", input.model());
        body.put("prompt", input.prompt());
        body.put("duration", effectiveDuration);
        body.put("response_format", "url");
        if (input.draft()) {
            body.put("draft", true);
        }
        body.set("metadata", metadata);

        String bodyJson;
        try {
            bodyJson = JSON.writeValueAsString(body);
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "请求序列化失败");
        }

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + "/v1/video/generations")
                .post(RequestBody.create(bodyJson, JSON_TYPE))
                .header("Content-Type", "application/json");
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        Request request = requestBuilder.build();

        Response response;
        try {
            response = submitClient.newCall(request).execute();
        } catch (SocketTimeoutException e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 视频提交超时", e);
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 视频提交失败: " + e.getMessage());
        }

        try (response) {
            ResponseBody respBody = response.body();
            String rawText = respBody != null ? respBody.string() : "";

            if (!response.isSuccessful()) {
                String code = classifySubmitFailure(rawText, response.code());
                String truncated = rawText.length() > 300 ? rawText.substring(0, 300) + "…" : rawText;
                throw new VideoProviderError(code,
                        "new-api 视频提交失败: HTTP " + response.code() + " body=" + truncated,
                        new HttpStatusException(response.code()));
            }

            JsonNode parsed;
            try {
                parsed = JSON.readTree(rawText);
            } catch (Exception e) {
                throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "new-api 视频提交响应非 JSON");
            }

            return parseSubmitResult(parsed);
        } catch (VideoProviderError e) {
            throw e;
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 视频提交解析失败: " + e.getMessage());
        }
    }

    public SubmitResult finalize(String token, String sampleTaskId) {
        String traceId = UUID.randomUUID().toString();

        ObjectNode body = JSON.createObjectNode();
        body.put("resolution", VideoSampleContract.VIDEO_FINAL_RESOLUTION);
        body.put("watermark", watermarkPolicy.enabled());

        String bodyJson;
        try {
            bodyJson = JSON.writeValueAsString(body);
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "请求序列化失败");
        }

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + "/v1/videos/" + encodePath(sampleTaskId) + "/finalize")
                .post(RequestBody.create(bodyJson, JSON_TYPE))
                .header("Content-Type", "application/json");
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        Request request = requestBuilder.build();

        Response response;
        try {
            response = submitClient.newCall(request).execute();
        } catch (SocketTimeoutException e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 成片提交超时");
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 成片提交失败: " + e.getMessage());
        }

        try (response) {
            ResponseBody respBody = response.body();
            String rawText = respBody != null ? respBody.string() : "";

            if (!response.isSuccessful()) {
                String code = classifySubmitFailure(rawText, response.code());
                String truncated = rawText.length() > 300 ? rawText.substring(0, 300) + "…" : rawText;
                throw new VideoProviderError(code,
                        "new-api 成片提交失败: HTTP " + response.code() + " body=" + truncated,
                        new HttpStatusException(response.code()));
            }

            JsonNode parsed;
            try {
                parsed = JSON.readTree(rawText);
            } catch (Exception e) {
                throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "new-api 成片提交响应非 JSON");
            }

            return parseSubmitResult(parsed);
        } catch (VideoProviderError e) {
            throw e;
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 成片提交解析失败: " + e.getMessage());
        }
    }

    private static String classifySubmitFailure(String rawText, int httpStatus) {
        String code = NewApiErrorClassifier.classifyError(rawText, httpStatus);
        if (GenerationError.ERROR_PROVIDER_FAILED.equals(code)
                && NewApiErrorClassifier.isTaskTypeSignal(rawText)) {
            return GenerationError.ERROR_TASK_TYPE_PARAM_CONSTRAINT;
        }
        return code;
    }

    private static SubmitResult parseSubmitResult(JsonNode parsed) {
        JsonNode data = parsed.has("data") && parsed.get("data").isObject()
                ? parsed.get("data") : parsed;

        String taskId = textOrNull(data, "task_id");
        if (taskId == null) taskId = textOrNull(data, "id");
        if (taskId == null || taskId.isEmpty()) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 视频提交响应缺少 task_id");
        }

        String status = textOrNull(data, "status");
        return new SubmitResult(taskId, status != null ? status : "queued");
    }

    public VideoTaskObservation poll(String token, String taskId) {
        String traceId = UUID.randomUUID().toString();

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + "/v1/video/generations/" + encodePath(taskId))
                .get();
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        Request request = requestBuilder.build();

        Response response;
        try {
            response = pollClient.newCall(request).execute();
        } catch (SocketTimeoutException e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "new-api 视频轮询超时");
        } catch (java.net.ConnectException e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 视频轮询网络不可达");
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 视频轮询失败: " + e.getMessage());
        }

        try (response) {
            ResponseBody respBody = response.body();
            String rawText = respBody != null ? respBody.string() : "";

            if (!response.isSuccessful()) {
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                String truncated = rawText.length() > 300 ? rawText.substring(0, 300) + "…" : rawText;
                throw new VideoProviderError(code,
                        "new-api 视频轮询失败: HTTP " + response.code() + " body=" + truncated,
                        new HttpStatusException(response.code()));
            }

            JsonNode parsed;
            try {
                parsed = JSON.readTree(rawText);
            } catch (Exception e) {
                throw new VideoProviderError("invalid_json_response",
                        "new-api 视频任务响应非 JSON");
            }

            JsonNode data = parsed.has("data") && parsed.get("data").isObject()
                    ? parsed.get("data") : parsed;

            String responseTaskId = textOrNull(data, "task_id");
            if (responseTaskId == null) responseTaskId = textOrNull(data, "id");
            String status = textOrNull(data, "status");

            if (responseTaskId == null || status == null) {
                throw new VideoProviderError("invalid_video_response",
                        "new-api 视频任务响应无效");
            }

            JsonNode rawError = data.has("error") && data.get("error").isObject() ? data.get("error") : null;
            if (rawError == null && data.path("data").path("error").isObject()) {
                rawError = data.get("data").get("error");
            }
            if (rawError == null && parsed.has("error") && parsed.get("error").isObject()) {
                rawError = parsed.get("error");
            }
            TaskError taskError = null;
            if (rawError != null) {
                String errCode = nodeTextOrNull(rawError, "code");
                String errMsg = nodeTextOrNull(rawError, "message");
                taskError = new TaskError(errCode, errMsg != null ? errMsg : "视频生成失败");
            }
            String failReason = firstTextOrNull(parsed, data, "fail_reason");

            Double quota = data.has("quota") && data.get("quota").isNumber()
                    ? data.get("quota").asDouble() : null;

            Long totalTokens = extractTotalTokens(data);

            Long upstreamCreatedAtMs = extractUpstreamCreatedAtMs(data);

            String url = textOrNull(data, "url");
            if (url == null) url = textOrNull(data, "result_url");

            String normalizedStatus = status.toLowerCase();

            if (SUCCESS_STATUSES.containsKey(normalizedStatus)) {
                return new VideoTaskObservation("succeeded", 100, url, quota, null, totalTokens,
                        upstreamCreatedAtMs);
            }
            if (FAILED_STATUSES.containsKey(normalizedStatus)) {
                String upstreamCode = taskError != null ? taskError.code() : null;
                String message = taskError != null && taskError.message() != null
                        ? taskError.message() : (failReason != null ? failReason : "视频生成失败");
                String upstreamText = (upstreamCode != null ? upstreamCode : "") + " "
                        + (failReason != null ? failReason : "") + " "
                        + (taskError != null && taskError.message() != null ? taskError.message() : "");
                String code;
                if (NewApiErrorClassifier.isOutputAudioCopyrightSignal(upstreamText)) {
                    code = GenerationError.ERROR_CONTENT_REJECTED_AUDIO;
                } else if (NewApiErrorClassifier.isCopyrightSignal(upstreamText)) {
                    code = GenerationError.ERROR_CONTENT_REJECTED_REFERENCE;
                } else if (NewApiErrorClassifier.isContentPolicySignal(upstreamText)) {
                    code = GenerationError.ERROR_CONTENT_REJECTED;
                } else if (NewApiErrorClassifier.isQuotaSignal(upstreamText)) {
                    code = GenerationError.ERROR_PLATFORM_QUOTA_EXHAUSTED;
                } else if (NewApiErrorClassifier.isReferenceImageSizeSignal(upstreamText)) {
                    code = GenerationError.ERROR_INVALID_REFERENCE_MEDIA;
                    message = "参考图尺寸不符合模型要求，请更换尺寸合适的图片后重试";
                } else if (NewApiErrorClassifier.isTaskTypeSignal(upstreamText)) {
                    code = GenerationError.ERROR_TASK_TYPE_PARAM_CONSTRAINT;
                } else {
                    code = upstreamCode != null ? upstreamCode : GenerationError.ERROR_PROVIDER_FAILED;
                }
                return new VideoTaskObservation("failed", 100, null, quota,
                        new TaskError(code, message), totalTokens, upstreamCreatedAtMs);
            }

            String obsStatus = "queued".equals(normalizedStatus) ? "queued" : "processing";
            return new VideoTaskObservation(obsStatus, 0, null, quota, null, totalTokens,
                    upstreamCreatedAtMs);
        } catch (VideoProviderError e) {
            throw e;
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 视频轮询解析失败: " + e.getMessage());
        }
    }

    private static Long extractTotalTokens(JsonNode data) {
        JsonNode inner = data.has("data") && data.get("data").isObject() ? data.get("data") : null;
        for (JsonNode node : new JsonNode[]{data, inner}) {
            if (node == null) continue;
            JsonNode usage = node.get("usage");
            Long fromObject = usage != null && usage.isObject()
                    ? firstToken(usage, "total_tokens", "completion_tokens") : null;
            if (fromObject != null) return fromObject;
            Long fromFlat = firstToken(node, "usage_total_tokens", "usage_completion_tokens");
            if (fromFlat != null) return fromFlat;
        }
        return null;
    }

    private static Long firstToken(JsonNode node, String... fields) {
        for (String field : fields) {
            JsonNode value = node.get(field);
            if (value == null) continue;
            Long parsed = null;
            if (value.isNumber()) {
                parsed = value.asLong();
            } else if (value.isTextual()) {
                try {
                    parsed = Long.parseLong(value.asText().trim());
                } catch (NumberFormatException ignored) {
                }
            }
            if (parsed != null && parsed > 0) {
                return parsed;
            }
        }
        return null;
    }

    private static Long extractUpstreamCreatedAtMs(JsonNode data) {
        JsonNode inner = data.has("data") && data.get("data").isObject() ? data.get("data") : null;
        for (JsonNode node : new JsonNode[]{data, inner}) {
            if (node == null) continue;
            Long raw = firstToken(node, "created_at", "created_at_ms");
            if (raw == null || raw <= 0) continue;
            return raw < 1_000_000_000_000L ? raw * 1000 : raw;
        }
        return null;
    }


    private static boolean hasVideoReference(List<VideoReference> references) {
        for (VideoReference ref : references) {
            if ("video".equals(ref.type())) return true;
        }
        return false;
    }

    private ObjectNode buildContentItem(String typeKey, String url, String role) {
        ObjectNode item = JSON.createObjectNode();
        item.put("type", typeKey);
        ObjectNode urlObj = JSON.createObjectNode();
        urlObj.put("url", url);
        urlObj.put("role", role);
        item.set(typeKey, urlObj);
        item.put("role", role);
        return item;
    }

    private static String textOrNull(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return (v != null && v.isTextual()) ? v.asText() : null;
    }

    private static String nodeTextOrNull(JsonNode node, String field) {
        JsonNode v = node.get(field);
        if (v == null) return null;
        if (v.isTextual()) return v.asText();
        if (v.isNumber()) return v.asText();
        return null;
    }

    private static String firstTextOrNull(JsonNode primary, JsonNode secondary, String field) {
        String v = textOrNull(primary, field);
        return v != null ? v : textOrNull(secondary, field);
    }

    private static String encodePath(String value) {
        return java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8);
    }

    public static class HttpStatusException extends Exception
            implements NewApiHttpSupport.HttpStatusCarrier {
        private final int status;
        public HttpStatusException(int status) { super("HTTP " + status); this.status = status; }
        @Override
        public int getStatus() { return status; }
    }

    public record SubmitResult(String taskId, String status) {}

    public record VideoTaskObservation(
            String status,
            int progress,
            String url,
            Double quota,
            TaskError error,
            Long totalTokens,
            Long upstreamCreatedAtMs
    ) {
        public VideoTaskObservation(
                String status, int progress, String url, Double quota, TaskError error, Long totalTokens) {
            this(status, progress, url, quota, error, totalTokens, null);
        }
    }

    public record TaskError(String code, String message) {}

    public record VideoSubmitInput(
            String model,
            String prompt,
            double duration,
            String resolution,
            String ratio,
            String firstFrameImage,
            String lastFrameImage,
            List<VideoReference> references,
            Boolean generateAudio,
            boolean draft,
            String videoTaskType,
            boolean omniTaskTypeAllowed
    ) {
        public VideoSubmitInput(
                String model, String prompt, double duration, String resolution, String ratio,
                String firstFrameImage, String lastFrameImage,
                List<VideoReference> references, Boolean generateAudio) {
            this(model, prompt, duration, resolution, ratio, firstFrameImage, lastFrameImage,
                    references, generateAudio, false, null, false);
        }

        public VideoSubmitInput(
                String model, String prompt, double duration, String resolution, String ratio,
                String firstFrameImage, String lastFrameImage, List<VideoReference> references,
                Boolean generateAudio, boolean draft, String videoTaskType) {
            this(model, prompt, duration, resolution, ratio, firstFrameImage, lastFrameImage,
                    references, generateAudio, draft, videoTaskType, true);
        }
    }

    public record VideoReference(String type, String url, String role) {

        public VideoReference(String type, String url) {
            this(type, url, null);
        }
    }
}
