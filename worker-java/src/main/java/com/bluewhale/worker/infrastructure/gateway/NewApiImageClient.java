package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageProviderError;
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

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * new-api 图片生成客户端（new-api-generation-ops.ts:22-175 逐字移植）。
 * <p>
 * 端点选择规则（缺陷修复，对齐 TS 活路径）：
 * <b>有无参考图都走 POST /v1/images/generations（JSON），参考图以 <code>image</code> 字段进 body</b>
 * （new-api-generation-ops.ts:28-60 + ark-image-provider.ts:123「IKDMQE：有无参考图都走
 * generations；edits 被 highwayapi 拒绝」）。图片-2 / banana2 上游挂在建桥 jiekouAI 渠道
 * （blue-whale-api relay/channel/highwayapi/adaptor.go:44-46,113-116），该渠道设计上
 * 拒绝 /v1/images/edits（模型名拼 URL 路径、body 透传），edits multipart 永远 500。
 * editImagesWithReceipt 在 TS 生产零调用方（IKDMQE 改道后遗留死导出），移植时不得当活规则。
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
@org.springframework.context.annotation.Conditional(com.bluewhale.worker.config.ImageEnabledCondition.class)
public class NewApiImageClient {

    private static final Logger log = LoggerFactory.getLogger(NewApiImageClient.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final MediaType JSON_TYPE = MediaType.get("application/json");

    /** 默认读超时 300s（banana2/Gemini 系 i2i 实测 >240s 仍未返回，本地 job 1822 实证；
     *  env NEW_API_IMAGE_TIMEOUT_MS 可覆盖）。配套：image claim 租约默认 420s
     *  （JobStateMachineService），必须 > 超时 + 转存余量，否则 recovery 把在跑的 job
     *  当孤儿重投 → 双跑双扣（比超时重试更糟）。 */
    private static final int DEFAULT_TIMEOUT_MS = 300_000;

    private final OkHttpClient httpClient;
    private final String baseUrl;

    public NewApiImageClient() {
        this(System.getenv("NEW_API_BASE_URL"));
    }

    /** 测试用构造器：注入 base URL，超时走 env/默认。 */
    NewApiImageClient(String baseUrl) {
        this(baseUrl, loadTimeoutMs());
    }

    /** 测试用构造器：注入读/写超时（毫秒）。 */
    NewApiImageClient(String baseUrl, int timeoutMs) {
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalStateException("NEW_API_BASE_URL 未配置");
        }
        this.baseUrl = baseUrl.replaceAll("/+$", "");

        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .build();
    }

    /**
     * 图片生成（new-api-generation-ops.ts:28-60 generateImagesWithReceipt 移植）。
     * <p>
     * 恒走 /v1/images/generations；sourceImages 非空时以 JSON <code>image</code> 字段
     * 透传（单张=字符串、多张=数组，逐字对齐 ark-image-provider.ts referenceImageField）。
     *
     * @param token         per-job Bearer 凭证
     * @param model         模型 ID（capability.model_id，可能经渠道映射或契约 §11 别名分流）
     * @param prompt        提示词
     * @param n             生成数量（1-4）
     * @param size          尺寸（provider 级别，经渠道映射后）
     * @param quality       质量（banana 渠道才有，可选）
     * @param webSearch     是否启用网络搜索
     * @param sequential    是否顺序生成
     * @param sourceImages  参考图 URL 列表（非空 → body.image 透传；恒 generations）
     * @return 生成结果列表
     * @throws ImageProviderError 按错误分类抛错
     */
    public List<GeneratedImage> generate(
            String token, String model, String prompt, int n,
            String size, String quality, boolean webSearch, boolean sequential,
            List<String> sourceImages
    ) {
        String traceId = UUID.randomUUID().toString();

        Request request = buildGenerationsRequest(token, model, prompt, n, size, quality,
                webSearch, sequential, sourceImages, traceId);

        Response response;
        try {
            response = httpClient.newCall(request).execute();
        } catch (java.net.SocketTimeoutException e) {
            // 2026-09-11 政策修订（IKF12J 讨论，用户拍板）：**读超时不重试**——请求已到达上游，
            // 可能已出图扣费，重试=双扣；归 provider_timeout 终态，靠拉大超时窗口（240s）消化慢上游。
            // 连接超时（请求未送达，零扣费风险）仍归 provider_failed 瞬态可重试。
            // 注意：TS 旧行为把超时混进 provider_failed 一并重试，属其双扣隐患——Node 退役中不改，
            // Java 侧按本政策执行（契约 §11 政策条款）。
            String msg = String.valueOf(e.getMessage()).toLowerCase();
            if (msg.contains("connect")) {
                throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "new-api 图片连接超时: " + e.getMessage());
            }
            throw new ImageProviderError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "new-api 图片生成超时");
        } catch (java.net.ConnectException | java.net.UnknownHostException e) {
            // 连接被拒 / DNS 失败：POST 未达上游、零扣费风险 → 瞬态可重试。
            throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 图片生成失败: " + e.getMessage());
        } catch (Exception e) {
            // 其余 IO（连接重置 / 流中断 / SSL 中途失败等）**可能发生在 POST 之后**，上游或已出图扣费
            // → 终态不重试（宁可不重试也不双扣；评审 Important#1）。异常类名入 message 便于排查。
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

    /**
     * 构建 JSON 请求 /v1/images/generations（new-api-generation-ops.ts:28-60）。
     * body 字段序与 TS 逐字（model/prompt/response_format/stream/size/quality/image/n/tools/…），
     * image：单张=URL 字符串、多张=URL 数组（ark-image-provider.ts referenceImageField 同形）。
     */
    private Request buildGenerationsRequest(
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

    private static int loadTimeoutMs() {
        String raw = System.getenv("NEW_API_IMAGE_TIMEOUT_MS");
        if (raw != null) {
            try {
                int n = Integer.parseInt(raw);
                if (n > 0) return n;
            } catch (NumberFormatException e) {
                log.debug("NEW_API_IMAGE_TIMEOUT_MS 解析失败，使用默认值: {}", e.getMessage());
            }
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
