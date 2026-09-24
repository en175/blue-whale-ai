package com.bluewhale.worker.infrastructure.gateway;
import com.bluewhale.common.http.NewApiHttpSupport;

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
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * new-api 图片生成客户端。
 * <p>
 * <b>端点与请求形态由 {@link ImageProtocol} 决定</b>（能力行 {@code features.image_protocol}，
 * IKF4LI），不按模型名特判：
 * <ul>
 *   <li>{@link ImageProtocol#OPENAI_IMAGES}（gpt-image-2）：无参考图 →
 *       {@code POST /v1/images/generations}（JSON）；有参考图 → {@code POST /v1/images/edits}
 *       （multipart，参考图先下载成字节）。只发官方字段。</li>
 *   <li>{@link ImageProtocol#INLINE_IMAGE}（banana / seedream，现状）：恒
 *       {@code POST /v1/images/generations}（JSON），参考图以 URL 进 body {@code image}。</li>
 * </ul>
 * <p>
 * 2026-09-11 上游改造（gpt-image-2 切官方协议）实测：generations 带 {@code image} 字段与
 * 带 {@code response_format} 均被上游 400（{@code Unknown parameter}）；图生图必须走
 * {@code /v1/images/edits} multipart，且模型名恒为 {@code gpt-image-2} 不换名。旧的建桥
 * 渠道（模型名拼 URL 路径）已废弃，不保留兼容分支。
 * <p>
 * 请求头（契约 §5 / ADR-0080）：
 * <ul>
 *   <li>Authorization: Bearer per-job 解封凭证</li>
 *   <li>X-Trace-Id：请求追踪</li>
 *   <li>X-Client-System: bluewhale（ADR-0080 白名单头）</li>
 * </ul>
 * <p>
 * 响应：{@code {data:[{url|b64_json}]}}——两种形态都支持（官方 GPT Image 系只回 b64_json）。
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

    /** 默认读超时 300s（banana2/Gemini 系 i2i 实测 >240s 仍未返回，本地 job 1822 实证；
     *  env NEW_API_IMAGE_TIMEOUT_MS 可覆盖）。配套：image claim 租约默认 420s
     *  （JobStateMachineService），必须 > 超时 + 转存余量，否则 recovery 把在跑的 job
     *  当孤儿重投 → 双跑双扣（比超时重试更糟）。 */
    private static final int DEFAULT_TIMEOUT_MS = 300_000;

    /** 参考图下载读超时（官方协议上传前取素材；与生成超时分开，避免一次卡死的下载吃掉
     *  整个生成预算）。下载失败发生在 POST 上游**之前**——零扣费风险，故归 provider_failed
     *  瞬态可重试。 */
    private static final long SOURCE_IMAGE_TIMEOUT_MS = 30_000L;

    private final OkHttpClient httpClient;
    private final OkHttpClient sourceImageClient;
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
        this.baseUrl = NewApiHttpSupport.normalizeBaseUrl(baseUrl);

        this.httpClient = NewApiHttpSupport.buildClient(10_000, timeoutMs, timeoutMs);
        this.sourceImageClient = NewApiHttpSupport.buildClient(10_000, SOURCE_IMAGE_TIMEOUT_MS, SOURCE_IMAGE_TIMEOUT_MS);
    }

    /**
     * 图片生成。
     *
     * @param token         per-job Bearer 凭证
     * @param protocol      出站协议（能力行 features.image_protocol）
     * @param model         上游模型名（= 能力行 model_id，不再做别名分流）
     * @param prompt        提示词
     * @param n             生成数量（1-4）
     * @param size          尺寸（provider 级别，经渠道映射后）
     * @param quality       质量（banana 渠道才有，可选）
     * @param webSearch     是否启用网络搜索（仅 INLINE_IMAGE 生效；官方协议无此字段）
     * @param sequential    是否顺序生成（仅 INLINE_IMAGE 生效；官方协议无此字段）
     * @param sourceImages  参考图 URL 列表（OPENAI_IMAGES 下由本类下载为字节走 multipart）
     * @return 生成结果列表
     * @throws ImageProviderError 按错误分类抛错
     */
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
            // 2026-09-11 政策修订（IKF12J 讨论，用户拍板）：**读超时不重试**——请求已到达上游，
            // 可能已出图扣费，重试=双扣；归 provider_timeout 终态，靠拉大超时窗口（300s）消化慢上游。
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

    // ========== 官方 OpenAI Images 协议 ==========

    /**
     * 官方协议·纯文生图：{@code POST /v1/images/generations}（JSON）。
     * <p>
     * 只发官方字段。**不发 {@code response_format}**（上游 400 Unknown parameter，旧代码
     * 每次调用都因此失败），也不发 {@code stream}/{@code tools}/
     * {@code sequential_image_generation}（非官方字段，官方协议不依赖）。
     */
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

    /**
     * 官方协议·图生图：{@code POST /v1/images/edits}（multipart/form-data）。
     * <p>
     * 参考图必须作为**文件字节**上传（官方契约：generations 不接受参考图），故先按 URL
     * 下载，再以 {@code image} 字段逐个追加（官方支持多图，追加次序即数组次序）。
     * <p>
     * <b>不手动设置 Content-Type</b>——okhttp 的 MultipartBody 需自带 boundary。
     */
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

    /**
     * 下载参考图（官方协议 multipart 上传前取素材）。
     * <p>
     * 失败归 {@code provider_failed}（瞬态可重试）：下载发生在 POST 上游**之前**，
     * 零扣费风险，重试不违反「已可能扣费就不重试」政策。
     */
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

    // ========== 旧形态（inline） ==========

    /**
     * 构建 JSON 请求 /v1/images/generations（new-api-generation-ops.ts:28-60）。
     * body 字段序与 TS 逐字（model/prompt/response_format/stream/size/quality/image/n/tools/…），
     * image：单张=URL 字符串、多张=URL 数组（ark-image-provider.ts referenceImageField 同形）。
     */
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

    // ========== 响应解析 ==========

    /**
     * 从信封 data 提取图片列表。
     * <p>
     * 支持两种元素形态（**无条件**，与协议无关）：
     * <ul>
     *   <li>{@code url}（网关托管 URL，banana/seedream 现用）</li>
     *   <li>{@code b64_json}（官方 GPT Image 系唯一形态）→ 解码为字节，mime 按魔数嗅探</li>
     * </ul>
     * 两者皆无的元素丢弃（与 TS filter 一致）；b64 解不开的也丢弃，不炸整批。
     */
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

    // ========== 内部工具 ==========

    private String serialize(Map<String, Object> payload) {
        try {
            return JSON.writeValueAsString(payload);
        } catch (Exception e) {
            throw new ImageProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "请求序列化失败");
        }
    }

    /**
     * 图片 MIME 嗅探：优先魔数（b64_json 响应没有 Content-Type 头），
     * 魔数不认识才回退响应头，最后兜底 image/png（官方 GPT Image 默认输出格式）。
     * <p>
     * public：ImageEnhanceJobProcessor（跨包）转存结果图时复用同一嗅探逻辑。
     */
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

    /** MIME → 文件扩展名（multipart 文件名用，上游据此判类型）。 */
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

    /** 下载好的参考图（字节 + 类型 + multipart 文件名）。 */
    private record DownloadedImage(byte[] content, String mime, String fileName) {}

    /**
     * 图片生成结果（对齐 TS NewApiImage / GeneratedImage，image-provider.ts:29-35）。
     * <p>
     * {@code url} 与 {@code content} 互斥：网关托管 URL（inline 形态）或已解码字节
     * （b64_json 形态，mime 由魔数嗅探）。
     */
    public record GeneratedImage(
            String url,
            byte[] content,
            String mime,
            Integer width,
            Integer height,
            String requestId
    ) {}
}
