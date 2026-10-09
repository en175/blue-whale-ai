package com.bluewhale.worker.infrastructure.gateway;
import com.bluewhale.common.http.NewApiHttpSupport;

import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageProviderError;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
public class NewApiImageClient {

    private static final Logger log = LoggerFactory.getLogger(NewApiImageClient.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final MediaType JSON_TYPE = MediaType.get("application/json");

    private static final int DEFAULT_TIMEOUT_MS = 300_000;

    private static final long SOURCE_IMAGE_TIMEOUT_MS = 30_000L;

    private final OkHttpClient httpClient;
    private final OkHttpClient sourceImageClient;
    private final String baseUrl;

    @Autowired
    public NewApiImageClient(UpstreamBaseUrl baseUrl) {
        this(baseUrl, loadTimeoutMs());
    }

    NewApiImageClient(UpstreamBaseUrl baseUrl, int timeoutMs) {
        this.baseUrl = baseUrl.normalized();

        this.httpClient = NewApiHttpSupport.buildClient(10_000, timeoutMs, timeoutMs);
        this.sourceImageClient = NewApiHttpSupport.buildClient(10_000, SOURCE_IMAGE_TIMEOUT_MS, SOURCE_IMAGE_TIMEOUT_MS);
    }

    public List<GeneratedImage> generate(
            String token, ImageProtocol protocol, String model, String prompt, int n,
            String size, String quality, boolean webSearch, boolean sequential,
            List<String> sourceImages
    ) {
        String traceId = UUID.randomUUID().toString();
        boolean hasSourceImages = sourceImages != null && !sourceImages.isEmpty();

        Request request;
        if (protocol == ImageProtocol.OPENAI_IMAGES) {
            request = hasSourceImages
                    ? buildOpenAiEditsRequest(token, model, prompt, n, size, quality,
                            sourceImages, traceId)
                    : buildOpenAiGenerationsRequest(token, model, prompt, n, size, quality,
                            traceId);
        } else {
            request = buildInlineGenerationsRequest(token, model, prompt, n, size, quality,
                    webSearch, sequential, sourceImages, traceId);
        }

        Response response;
        try {
            response = httpClient.newCall(request).execute();
        } catch (java.net.SocketTimeoutException e) {
            String msg = String.valueOf(e.getMessage()).toLowerCase();
            if (msg.contains("connect")) {
                throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "new-api 图片连接超时: " + e.getMessage());
            }
            throw new ImageProviderError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "new-api 图片生成超时");
        } catch (java.net.ConnectException | java.net.UnknownHostException e) {
            throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 图片生成失败: " + e.getMessage());
        } catch (Exception e) {
            throw new ImageProviderError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "new-api 图片生成失败（可能已扣费，不重试）: "
                            + e.getClass().getSimpleName() + ": " + e.getMessage());
        }

        try (response) {
            String requestId = response.header("X-Oneapi-Request-Id");
            ResponseBody body = response.body();
            String rawText = body != null ? body.string() : "";

            if (!response.isSuccessful()) {
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                String truncated = rawText.length() > 300 ? rawText.substring(0, 300) + "…" : rawText;
                throw new ImageProviderError(code,
                        "new-api 图片生成失败: HTTP " + response.code() + " body=" + truncated);
            }

            JsonNode parsed;
            try {
                parsed = JSON.readTree(rawText);
            } catch (Exception e) {
                throw new ImageProviderError(GenerationError.ERROR_NO_RESULT,
                        "生成服务未返回有效 JSON");
            }

            JsonNode errorNode = parsed.get("error");
            if (errorNode != null && errorNode.has("message")) {
                String errText = errorNode.get("message").asText();
                String code = NewApiErrorClassifier.classifySuccessEnvelope(errText);
                throw new ImageProviderError(code, "new-api 图片生成业务失败");
            }

            return parseImageList(parsed.get("data"), requestId);
        } catch (ImageProviderError e) {
            throw e;
        } catch (Exception e) {
            throw new ImageProviderError(GenerationError.ERROR_NO_RESULT,
                    "生成服务未返回有效 JSON");
        }
    }


    private Request buildOpenAiGenerationsRequest(
            String token, String model, String prompt, int n,
            String size, String quality, String traceId
    ) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", model);
        payload.put("prompt", prompt);
        payload.put("n", n);
        if (size != null) payload.put("size", size);
        if (quality != null) payload.put("quality", quality);

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + "/v1/images/generations")
                .post(RequestBody.create(serialize(payload), JSON_TYPE))
                .header("Content-Type", "application/json");
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        return requestBuilder.build();
    }

    private Request buildOpenAiEditsRequest(
            String token, String model, String prompt, int n,
            String size, String quality, List<String> sourceImages, String traceId
    ) {
        MultipartBody.Builder form = new MultipartBody.Builder().setType(MultipartBody.FORM);
        form.addFormDataPart("model", model);
        form.addFormDataPart("prompt", prompt);
        form.addFormDataPart("n", String.valueOf(n));
        if (size != null) form.addFormDataPart("size", size);
        if (quality != null) form.addFormDataPart("quality", quality);
        for (int i = 0; i < sourceImages.size(); i++) {
            DownloadedImage image = downloadSourceImage(sourceImages.get(i), i + 1);
            form.addFormDataPart("image", image.fileName(),
                    RequestBody.create(image.content(), MediaType.get(image.mime())));
        }

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + "/v1/images/edits")
                .post(form.build());
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        return requestBuilder.build();
    }

    private DownloadedImage downloadSourceImage(String url, int index) {
        Response response;
        try {
            response = sourceImageClient.newCall(new Request.Builder().url(url).get().build())
                    .execute();
        } catch (Exception e) {
            throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "参考图下载失败（未提交上游，可重试）: " + e.getMessage());
        }

        try (response) {
            if (!response.isSuccessful()) {
                throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "参考图下载失败: HTTP " + response.code() + " url=" + url);
            }
            ResponseBody body = response.body();
            byte[] content;
            try {
                content = body != null ? body.bytes() : new byte[0];
            } catch (Exception e) {
                throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "参考图下载读取失败（未提交上游，可重试）: " + e.getMessage());
            }
            if (content.length == 0) {
                throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "参考图内容为空: " + url);
            }
            String mime = sniffImageMime(content, response.header("Content-Type"));
            return new DownloadedImage(content, mime, "image-" + index + "." + extForMime(mime));
        }
    }


    private Request buildInlineGenerationsRequest(
            String token, String model, String prompt, int n,
            String size, String quality, boolean webSearch, boolean sequential,
            List<String> sourceImages, String traceId
    ) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", model);
        payload.put("prompt", prompt);
        payload.put("response_format", "url");
        payload.put("stream", false);
        if (size != null) payload.put("size", size);
        if (quality != null) payload.put("quality", quality);
        if (sourceImages != null && !sourceImages.isEmpty()) {
            payload.put("image", sourceImages.size() == 1 ? sourceImages.get(0) : sourceImages);
        }
        payload.put("n", n);
        if (webSearch) payload.put("tools", List.of(Map.of("type", "web_search")));
        if (sequential) {
            payload.put("sequential_image_generation", "auto");
            payload.put("sequential_image_generation_options",
                    Map.of("max_images", n));
        }

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + "/v1/images/generations")
                .post(RequestBody.create(serialize(payload), JSON_TYPE))
                .header("Content-Type", "application/json");
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        return requestBuilder.build();
    }


    private List<GeneratedImage> parseImageList(JsonNode dataNode, String requestId) {
        List<GeneratedImage> result = new ArrayList<>();
        if (dataNode == null || !dataNode.isArray()) return result;

        for (JsonNode item : dataNode) {
            if (item == null || !item.isObject()) continue;

            JsonNode b64Node = item.get("b64_json");
            if (b64Node != null && b64Node.isTextual() && !b64Node.asText().isEmpty()) {
                byte[] content;
                try {
                    content = Base64.getDecoder().decode(b64Node.asText());
                } catch (IllegalArgumentException e) {
                    log.warn("图片 b64_json 解码失败，丢弃该元素: {}", e.getMessage());
                    continue;
                }
                if (content.length == 0) continue;
                String mime = sniffImageMime(content, null);
                result.add(new GeneratedImage(null, content, mime, null, null, requestId));
                continue;
            }

            JsonNode urlNode = item.get("url");
            if (urlNode == null || !urlNode.isTextual()) continue;
            String url = urlNode.asText();
            if (url.isEmpty()) continue;
            result.add(new GeneratedImage(url, null, null, null, null, requestId));
        }
        return result;
    }


    private String serialize(Map<String, Object> payload) {
        try {
            return JSON.writeValueAsString(payload);
        } catch (Exception e) {
            throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "请求序列化失败");
        }
    }

    public static String sniffImageMime(byte[] data, String contentTypeHeader) {
        if (startsWith(data, 0x89, 'P', 'N', 'G')) return "image/png";
        if (startsWith(data, 0xFF, 0xD8, 0xFF)) return "image/jpeg";
        if (data.length >= 12
                && startsWith(data, 'R', 'I', 'F', 'F')
                && data[8] == 'W' && data[9] == 'E' && data[10] == 'B' && data[11] == 'P') {
            return "image/webp";
        }
        if (startsWith(data, 'G', 'I', 'F', '8')) return "image/gif";
        if (contentTypeHeader != null && contentTypeHeader.startsWith("image/")) {
            return contentTypeHeader.split(";", 2)[0].trim();
        }
        return "image/png";
    }

    static String extForMime(String mime) {
        if ("image/jpeg".equals(mime)) return "jpg";
        if ("image/webp".equals(mime)) return "webp";
        if ("image/gif".equals(mime)) return "gif";
        return "png";
    }

    private static boolean startsWith(byte[] data, int... expected) {
        if (data.length < expected.length) return false;
        for (int i = 0; i < expected.length; i++) {
            if ((data[i] & 0xFF) != (expected[i] & 0xFF)) return false;
        }
        return true;
    }

    private static int loadTimeoutMs() {
        return NewApiUpstreamConfig.timeoutMs("NEW_API_IMAGE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
    }

    private record DownloadedImage(byte[] content, String mime, String fileName) {}

    public record GeneratedImage(
            String url,
            byte[] content,
            String mime,
            Integer width,
            Integer height,
            String requestId
    ) {}
}
