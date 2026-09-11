package com.bluewhale.worker.infrastructure.gateway;

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
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * new-api 图片生成客户端（new-api-generation-ops.ts:22-175 逐字移植）。
 * <p>
 * 端点选择规则（new-api-generation-ops.ts:118-120 / 66-69）：
 * <ul>
 *   <li>有参考图 → POST /v1/images/edits（multipart，:66-69 editImagesWithReceipt）</li>
 *   <li>无参考图 → POST /v1/images/generations（JSON，:22-60 generateImagesWithReceipt）</li>
 * </ul>
 * <p>
 * 请求头（契约 §5 / ADR-0080）：
 * <ul>
 *   <li>Authorization: Bearer per-job 解封凭证</li>
 *   <li>X-Trace-Id：请求追踪</li>
 *   <li>X-Client-System: bluewhale（ADR-0080 白名单头）</li>
 * </ul>
 * <p>
 * 响应：{data:[{url|b64_json}]}（parseImageList，new-api-generation-ops.ts:333-344）。
 * <p>
 * 错误分类复用 NewApiErrorClassifier（blade-② audio 同构，blade-③ 提取为共享类）。
 * <p>
 * 修正三：ARK provider（ark-image-provider.ts）不移植——new-api 网关是唯一 provider。
 */
@Component
public class NewApiImageClient {

    private static final Logger log = LoggerFactory.getLogger(NewApiImageClient.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final MediaType JSON_TYPE = MediaType.get("application/json");

    /** 默认超时 60s（图片生成比音频慢，new-api-client.ts DEFAULT_TIMEOUT_MS 同构）。 */
    private static final int DEFAULT_TIMEOUT_MS = 60_000;

    private final OkHttpClient httpClient;
    private final String baseUrl;

    public NewApiImageClient() {
        this(System.getenv("NEW_API_BASE_URL"));
    }

    /** 测试用构造器：注入 base URL。 */
    NewApiImageClient(String baseUrl) {
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalStateException("NEW_API_BASE_URL 未配置");
        }
        this.baseUrl = baseUrl.replaceAll("/+$", "");

        int timeoutMs = loadTimeoutMs();
        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .build();
    }

    /**
     * 图片生成（new-api-generation-ops.ts 完整移植）。
     * <p>
     * 端点选择（new-api-generation-ops.ts:66 vs :22）：
     * <ul>
     *   <li>sourceImages 非空 → /v1/images/edits（multipart）</li>
     *   <li>sourceImages 为空 → /v1/images/generations（JSON）</li>
     * </ul>
     *
     * @param token         per-job Bearer 凭证
     * @param model         模型 ID（capability.model_id，可能经渠道映射）
     * @param prompt        提示词
     * @param n             生成数量（1-4）
     * @param size          尺寸（provider 级别，经渠道映射后）
     * @param quality       质量（banana 渠道才有，可选）
     * @param webSearch     是否启用网络搜索
     * @param sequential    是否顺序生成
     * @param sourceImages  参考图 URL 列表（空 → generations，非空 → edits）
     * @return 生成结果列表
     * @throws ImageProviderError 按错误分类抛错
     */
    public List<GeneratedImage> generate(
            String token, String model, String prompt, int n,
            String size, String quality, boolean webSearch, boolean sequential,
            List<String> sourceImages
    ) {
        boolean useEdits = sourceImages != null && !sourceImages.isEmpty();
        String traceId = UUID.randomUUID().toString();

        Request request;
        if (useEdits) {
            request = buildEditsRequest(token, model, prompt, n, size, quality,
                    webSearch, sequential, sourceImages, traceId);
        } else {
            request = buildGenerationsRequest(token, model, prompt, n, size, quality,
                    webSearch, sequential, traceId);
        }

        Response response;
        try {
            response = httpClient.newCall(request).execute();
        } catch (java.net.SocketTimeoutException e) {
            throw new ImageProviderError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "new-api 图片生成超时");
        } catch (Exception e) {
            throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 图片生成失败: " + e.getMessage());
        }

        try (response) {
            String requestId = response.header("X-Oneapi-Request-Id");
            ResponseBody body = response.body();
            String rawText = body != null ? body.string() : "";

            if (!response.isSuccessful()) {
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                throw new ImageProviderError(code,
                        "new-api 图片生成失败: " + response.code());
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

    /**
     * 构建 JSON 请求 /v1/images/generations（new-api-generation-ops.ts:22-60）。
     */
    private Request buildGenerationsRequest(
            String token, String model, String prompt, int n,
            String size, String quality, boolean webSearch, boolean sequential,
            String traceId
    ) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", model);
        payload.put("prompt", prompt);
        payload.put("response_format", "url");
        payload.put("stream", false);
        if (size != null) payload.put("size", size);
        if (quality != null) payload.put("quality", quality);
        payload.put("n", n);
        if (webSearch) payload.put("tools", List.of(Map.of("type", "web_search")));
        if (sequential) {
            payload.put("sequential_image_generation", "auto");
            payload.put("sequential_image_generation_options",
                    Map.of("max_images", n));
        }

        String bodyJson;
        try {
            bodyJson = JSON.writeValueAsString(payload);
        } catch (Exception e) {
            throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "请求序列化失败");
        }

        return new Request.Builder()
                .url(baseUrl + "/v1/images/generations")
                .post(RequestBody.create(bodyJson, JSON_TYPE))
                .header("Authorization", "Bearer " + token)
                .header("X-Trace-Id", traceId)
                .header("X-Client-System", "bluewhale")
                .header("Content-Type", "application/json")
                .build();
    }

    /**
     * 构建 multipart 请求 /v1/images/edits（new-api-generation-ops.ts:66-115）。
     * <p>
     * TS 逐字移植：imageField = images.length === 1 ? "image" : "image[]"（:93-94）。
     */
    private Request buildEditsRequest(
            String token, String model, String prompt, int n,
            String size, String quality, boolean webSearch, boolean sequential,
            List<String> sourceImages, String traceId
    ) {
        if (sourceImages.isEmpty()) {
            throw new ImageProviderError(GenerationError.ERROR_INVALID_INPUT,
                    "图片编辑至少需要一张参考图");
        }

        MultipartBody.Builder builder = new MultipartBody.Builder()
                .setType(MultipartBody.FORM);
        builder.addFormDataPart("model", model);
        builder.addFormDataPart("prompt", prompt);

        // imageField（new-api-generation-ops.ts:93-94）
        String imageField = sourceImages.size() == 1 ? "image" : "image[]";
        // 评审修复：TS 侧 edits 传的是参考图**字节**（new-api-generation-ops.ts:114-123），
        // 原实现误把 URL 字符串当文件体 → 网关 400。先 GET 下载再入 multipart。
        for (int i = 0; i < sourceImages.size(); i++) {
            byte[] imgBytes = downloadBytes(sourceImages.get(i));
            builder.addFormDataPart(imageField, "ref_" + i + ".jpg",
                    RequestBody.create(imgBytes, MediaType.get("image/jpeg")));
        }

        builder.addFormDataPart("n", String.valueOf(n));
        builder.addFormDataPart("response_format", "url");
        if (size != null) builder.addFormDataPart("size", size);
        if (quality != null) builder.addFormDataPart("quality", quality);
        if (webSearch) {
            try {
                builder.addFormDataPart("tools",
                        JSON.writeValueAsString(List.of(Map.of("type", "web_search"))));
            } catch (Exception ignored) {}
        }
        if (sequential) {
            builder.addFormDataPart("sequential_image_generation", "auto");
            try {
                builder.addFormDataPart("sequential_image_generation_options",
                        JSON.writeValueAsString(Map.of("max_images", n)));
            } catch (Exception ignored) {}
        }

        return new Request.Builder()
                .url(baseUrl + "/v1/images/edits")
                .post(builder.build())
                .header("Authorization", "Bearer " + token)
                .header("X-Trace-Id", traceId)
                .header("X-Client-System", "bluewhale")
                .build();
    }

    /** 下载参考图字节（同源 fetch；失败按 unsupported_input 抛，对齐 TS 参考图片读取失败语义）。 */
    private byte[] downloadBytes(String url) {
        try (Response r = httpClient.newCall(new Request.Builder().url(url).build()).execute()) {
            if (!r.isSuccessful() || r.body() == null) {
                throw new ImageProviderError(GenerationError.ERROR_UNSUPPORTED_INPUT,
                        "参考图片读取失败: HTTP " + r.code());
            }
            return r.body().bytes();
        } catch (ImageProviderError e) {
            throw e;
        } catch (Exception e) {
            throw new ImageProviderError(GenerationError.ERROR_UNSUPPORTED_INPUT,
                    "参考图片读取失败: " + e.getMessage());
        }
    }

    /**
     * 从信封 data 提取图片列表（new-api-generation-ops.ts:333-344 parseImageList）。
     * 缺 url 的元素丢弃（与 TS filter 逐字一致）。
     */
    private List<GeneratedImage> parseImageList(JsonNode dataNode, String requestId) {
        List<GeneratedImage> result = new ArrayList<>();
        if (dataNode == null || !dataNode.isArray()) return result;

        for (JsonNode item : dataNode) {
            if (item == null || !item.isObject()) continue;
            JsonNode urlNode = item.get("url");
            if (urlNode == null || !urlNode.isTextual()) continue;
            String url = urlNode.asText();
            if (url.isEmpty()) continue;
            result.add(new GeneratedImage(url, null, null, requestId));
        }
        return result;
    }

    private int loadTimeoutMs() {
        String raw = System.getenv("NEW_API_IMAGE_TIMEOUT_MS");
        if (raw != null) {
            try {
                int n = Integer.parseInt(raw);
                if (n > 0) return n;
            } catch (NumberFormatException ignored) {}
        }
        return DEFAULT_TIMEOUT_MS;
    }

    /**
     * 图片生成结果（对齐 TS NewApiImage / GeneratedImage，image-provider.ts:29-35）。
     */
    public record GeneratedImage(
            String url,
            Integer width,
            Integer height,
            String requestId
    ) {}
}
