package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.contract.ImageCutoutContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageCutoutError;
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

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * new-api 网关 MediaKit 图像抠图客户端（契约章节 docs/specs/2026-09-18-image-cutout-mediakit.md /
 * IKGXM2；以 NewApiMediaKitEraseClient 为模板，两者各自独立 bean）。
 * <p>
 * 端点：{@code POST {NEW_API_BASE_URL}/v1/mediakit/sync/remove-image-background}（网关同步路由，
 * 本仓不直连火山、不新增凭证配置项——渠道与上游 API Key 在网关侧配置）。
 * 请求体为 MediaKit 原生参数，网关原样透传；model 字段为对客模型名
 * {@code mediakit-remove-image-background}（网关按模型名路由 MediaKit 渠道并计次计费，本期 model_price 配 0）。
 * <p>
 * 鉴权与图片生成同构（契约 §5 / ADR-0080）：Authorization: Bearer 任务冻结的用户 sk-（由
 * processor 从 job.input.provider_credential 取出传入）+ X-Trace-Id + X-Client-System: bluewhale。
 * <p>
 * 请求映射（参数名以火山官方 PDF「提交图像背景移除任务 API」为准；**无 tool_version**——
 * 官方 PDF 无此参数，区别于擦除；queue_id 可选不传——走系统默认队列）：
 * <ul>
 *   <li>image_url：源素材公网对象存储地址（Asset url 落库即 public-read，无需签名改造）</li>
 *   <li>scene：取 input.cutout_scene 同值直传（general / human / product）</li>
 *   <li>need_contour / contour_color / contour_size / need_crop_background：仅 human|product
 *       场景随请求携带（官方在 general 场景忽略描边与裁剪四参，规格故事 29：通用场景
 *       不携带接口会忽略的字段）；needContour=null 时四键均不发（processor 保证 general 传 null）</li>
 *   <li>output_format：固定 {@code png}（官方默认即 png 且支持透明；jpeg 透明填黑 / webp
 *       下游不兼容被规格否决）</li>
 * </ul>
 * <p>
 * 响应：网关原样透传火山同步响应，结果图地址在 {@code result.image_url}
 * （URL 仅 24h 有效，processor 须立即下载转存）。与擦除的差异：官方响应 result 自带
 * {@code image_width/image_height}，本客户端一并解析返回（缺失时 processor 以 ImageIO 兜底）。
 * 网关对 success=false 返 400 且不扣费。
 * <p>
 * 错误分类复用 NewApiErrorClassifier（content > quota > provider_failed，§5 优先级）；
 * 其余（超时 / 供应商失败 / 无结果）由 processor 归并兜底码 image_cutout_failed。
 */
@Component
public class NewApiMediaKitCutoutClient {

    private static final Logger log = LoggerFactory.getLogger(NewApiMediaKitCutoutClient.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final MediaType JSON_TYPE = MediaType.get("application/json");

    /** 网关同步路由路径（blue-whale-api 网关侧 MediaKit 渠道）。 */
    static final String CUTOUT_PATH = "/v1/mediakit/sync/remove-image-background";

    /** 对客模型名（契约章节：网关渠道路由 + model_price 配 0 免费口径）。 */
    static final String MODEL = "mediakit-remove-image-background";

    /**
     * 默认读超时 300s（同步抠图实测秒级返回，取与擦除/高清放大同窗口的保守值；
     * env NEW_API_IMAGE_CUTOUT_TIMEOUT_MS 可覆盖）。配套：claim 租约 420s（JobClaimService），
     * 必须 > 超时 + 下载转存余量，否则 recovery 把在跑任务当孤儿重投 → 双跑。
     */
    private static final int DEFAULT_TIMEOUT_MS = 300_000;

    private final OkHttpClient httpClient;
    private final String baseUrl;

    public NewApiMediaKitCutoutClient() {
        this(System.getenv("NEW_API_BASE_URL"));
    }

    /** 测试用构造器：注入 base URL，超时走 env/默认。 */
    NewApiMediaKitCutoutClient(String baseUrl) {
        this(baseUrl, loadTimeoutMs());
    }

    /** 测试用构造器：注入读/写超时（毫秒）。 */
    NewApiMediaKitCutoutClient(String baseUrl, int timeoutMs) {
        this.baseUrl = NewApiHttpSupport.normalizeBaseUrl(baseUrl);
        this.httpClient = NewApiHttpSupport.buildClient(10_000, timeoutMs, timeoutMs);
    }

    /**
     * 提交图像抠图（同步接口）。
     *
     * @param token              per-job Bearer 凭证（任务冻结的用户 sk-）
     * @param imageUrl           源素材公网对象存储地址
     * @param scene              火山 scene（general / human / product，直传）
     * @param needContour        主体描边开关（human|product 必传；null = general，增强四键均不发）
     * @param contourColor       描边颜色（固定 #FFFFFF，ImageCutoutContract.CONTOUR_COLOR）
     * @param contourSize        描边宽度 px（[1,100] 默认 10，web 侧钳制后传入）
     * @param needCropBackground 透明背景裁剪开关（human|product 必传）
     * @return 结果图（火山托管 URL，仅 24h 有效，调用方须立即下载转存；宽高为官方响应
     *         result.image_width/image_height，缺失时为 null 交调用方 ImageIO 兜底）
     * @throws ImageCutoutError 按错误分类抛错
     */
    public CutoutResult cutout(String token, String imageUrl, String scene,
                               Boolean needContour, String contourColor, Integer contourSize,
                               Boolean needCropBackground) {
        String traceId = UUID.randomUUID().toString();

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("image_url", imageUrl);
        payload.put("scene", scene);
        if (needContour != null) {
            // 增强四键恒成组携带（契约：human|product 四键恒在；general 出站不带）
            payload.put("need_contour", needContour);
            payload.put("contour_color", contourColor);
            payload.put("contour_size", contourSize);
            payload.put("need_crop_background", needCropBackground);
        }
        payload.put("output_format", ImageCutoutContract.OUTPUT_FORMAT);

        Request.Builder requestBuilder;
        try {
            requestBuilder = new Request.Builder()
                    .url(baseUrl + CUTOUT_PATH)
                    .post(RequestBody.create(JSON.writeValueAsString(payload), JSON_TYPE))
                    .header("Content-Type", "application/json");
        } catch (Exception e) {
            throw new ImageCutoutError(ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED,
                    "请求序列化失败");
        }
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        Request request = requestBuilder.build();

        Response response;
        try {
            response = httpClient.newCall(request).execute();
        } catch (java.net.SocketTimeoutException e) {
            // 超时统一终态不重试（无 worker 级自动重试；宁可不重试也不双跑）
            throw new ImageCutoutError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "MediaKit 图片抠图超时");
        } catch (Exception e) {
            // 连接失败 / 其余 IO：请求可能未达上游，零扣费风险——仍归终态（无自动重试）
            throw new ImageCutoutError(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit 图片抠图调用失败: " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }

        try (response) {
            ResponseBody body = response.body();
            String rawText = body != null ? body.string() : "";

            if (!response.isSuccessful()) {
                // 网关对 success=false / 未配价 / 缺渠道返 400 且不扣费——
                // 分类沿用 §5（content > quota > provider_failed），上游可读原因透传给前端投影。
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                String reason = extractUpstreamMessage(rawText);
                String message = "图片抠图失败: HTTP " + response.code();
                if (!reason.isEmpty()) {
                    message += " " + reason;
                } else {
                    message += " body=" + truncate(rawText);
                }
                throw new ImageCutoutError(code, message);
            }

            JsonNode parsed;
            try {
                parsed = JSON.readTree(rawText);
            } catch (Exception e) {
                throw new ImageCutoutError(ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED,
                        "MediaKit 未返回有效 JSON");
            }

            JsonNode errorNode = parsed.get("error");
            if (errorNode != null && errorNode.has("message")) {
                String errText = errorNode.get("message").asText();
                String code = NewApiErrorClassifier.classifySuccessEnvelope(errText);
                throw new ImageCutoutError(code, "MediaKit 图片抠图业务失败: " + truncate(errText));
            }

            JsonNode resultUrl = parsed.path("result").path("image_url");
            if (!resultUrl.isTextual() || resultUrl.asText().isEmpty()) {
                throw new ImageCutoutError(ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED,
                        "MediaKit 未返回结果图");
            }
            // 官方响应自带宽高（result.image_width/image_height）；缺失/非数值时置 null，
            // processor 以结果图 ImageIO 解析兜底（契约 §8 静默 null 等价标准）。
            JsonNode widthNode = parsed.path("result").path("image_width");
            JsonNode heightNode = parsed.path("result").path("image_height");
            Integer width = widthNode.isNumber() && widthNode.canConvertToInt()
                    ? widthNode.asInt() : null;
            Integer height = heightNode.isNumber() && heightNode.canConvertToInt()
                    ? heightNode.asInt() : null;
            return new CutoutResult(resultUrl.asText(), width, height);
        } catch (ImageCutoutError e) {
            throw e;
        } catch (Exception e) {
            throw new ImageCutoutError(ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED,
                    "MediaKit 响应读取失败: " + e.getMessage());
        }
    }

    // ========== 内部工具 ==========

    /**
     * 提取上游可读失败原因（网关 400 body 的 error.message 或顶层 message 字段）。
     * 供应商原因（如源图超门槛）透传给前端投影。
     */
    private static String extractUpstreamMessage(String rawText) {
        try {
            JsonNode node = JSON.readTree(rawText);
            JsonNode message = node.path("error").path("message");
            if (!message.isTextual() || message.asText().isEmpty()) {
                message = node.path("message");
            }
            if (message.isTextual() && !message.asText().isEmpty()) {
                return truncate(message.asText());
            }
        } catch (Exception e) {
            log.debug("上游错误 body 非法 JSON，回退原文截断: {}", e.getMessage());
        }
        return "";
    }

    private static String truncate(String text) {
        return text.length() > 300 ? text.substring(0, 300) + "…" : text;
    }

    private static int loadTimeoutMs() {
        String raw = System.getenv("NEW_API_IMAGE_CUTOUT_TIMEOUT_MS");
        if (raw != null) {
            try {
                int n = Integer.parseInt(raw);
                if (n > 0) return n;
            } catch (NumberFormatException e) {
                log.debug("NEW_API_IMAGE_CUTOUT_TIMEOUT_MS 解析失败，使用默认值: {}", e.getMessage());
            }
        }
        return DEFAULT_TIMEOUT_MS;
    }

    /**
     * 图片抠图结果：火山托管的结果图 URL（仅 24h 有效，processor 必须立即下载转存 TOS）
     * 与官方响应宽高（可 null，缺失时 processor 以 ImageIO 兜底）。
     */
    public record CutoutResult(String imageUrl, Integer imageWidth, Integer imageHeight) {}
}
