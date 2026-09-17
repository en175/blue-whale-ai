package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.entity.ImageOutpaintContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageOutpaintError;
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
 * new-api 网关 MediaKit 智能扩图客户端（IKGOQW，以 NewApiMediaKitClient 为模板）。
 * <p>
 * 端点：{@code POST {NEW_API_BASE_URL}/v1/mediakit/sync/expand-image-canvas}（网关同步路由，
 * 本仓不直连火山、不新增凭证配置项——渠道与上游 API Key 在网关侧配置）。
 * 请求体为 MediaKit 原生参数，网关原样透传；model 字段为对客模型名
 * {@code mediakit-expand-image-canvas}（网关按模型名路由 MediaKit 渠道并计次计费，本期 model_price 配 0）。
 * <p>
 * 请求映射（四键名 = ImageOutpaintContract，与火山 API 参数同名同值出站原样透传）：
 * <ul>
 *   <li>image_url：源素材公网对象存储地址（Asset url 落库即 public-read，无需签名改造）</li>
 *   <li>expand_top / expand_bottom / expand_left / expand_right：相对原图短边的扩展比例，
 *       产品总是显式传值（初始框零扩展即传 0），不依赖火山官方默认 0.1</li>
 *   <li>queue_id 不传（用火山系统自动创建的默认队列；规格 Out of Scope：队列分账）</li>
 * </ul>
 * <p>
 * 鉴权与图片生成同构（契约 §5 / ADR-0080）：Authorization: Bearer 任务冻结的用户 sk-（由
 * processor 从 job.input.provider_credential 取出传入）+ X-Trace-Id + X-Client-System: bluewhale。
 * <p>
 * 响应：网关原样透传火山同步响应，结果图地址在 {@code result.image_url}
 * （URL 仅 24h 有效，processor 须立即下载转存）。网关对 success=false 返 400 且不扣费。
 * <p>
 * 错误分类复用 NewApiErrorClassifier（content > quota > provider_failed，§5 优先级）；
 * 其余（超时 / 供应商失败 / 无结果）由 processor 归并兜底码 image_outpaint_failed。
 */
@Component
@org.springframework.context.annotation.Conditional(com.bluewhale.worker.config.ImageOutpaintEnabledCondition.class)
public class NewApiMediaKitOutpaintClient {

    private static final Logger log = LoggerFactory.getLogger(NewApiMediaKitOutpaintClient.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final MediaType JSON_TYPE = MediaType.get("application/json");

    /** 网关同步路由路径（blue-whale-api 网关侧 MediaKit 渠道）。 */
    static final String EXPAND_PATH = "/v1/mediakit/sync/expand-image-canvas";

    /** 对客模型名（网关渠道路由 + model_price 配 0 免费口径）。 */
    static final String MODEL = "mediakit-expand-image-canvas";

    /**
     * 默认读超时 300s（同步扩图实测秒级返回，与高清放大同窗口保守值；
     * env NEW_API_IMAGE_OUTPAINT_TIMEOUT_MS 可覆盖）。配套：claim 租约 420s（JobClaimService），
     * 必须 > 超时 + 下载转存余量，否则 recovery 把在跑任务当孤儿重投 → 双跑。
     */
    private static final int DEFAULT_TIMEOUT_MS = 300_000;

    private final OkHttpClient httpClient;
    private final String baseUrl;

    public NewApiMediaKitOutpaintClient() {
        this(System.getenv("NEW_API_BASE_URL"));
    }

    /** 测试用构造器：注入 base URL，超时走 env/默认。 */
    NewApiMediaKitOutpaintClient(String baseUrl) {
        this(baseUrl, loadTimeoutMs());
    }

    /** 测试用构造器：注入读/写超时（毫秒）。 */
    NewApiMediaKitOutpaintClient(String baseUrl, int timeoutMs) {
        this.baseUrl = NewApiHttpSupport.normalizeBaseUrl(baseUrl);
        this.httpClient = NewApiHttpSupport.buildClient(10_000, timeoutMs, timeoutMs);
    }

    /**
     * 提交智能扩图（同步接口）。
     *
     * @param token         per-job Bearer 凭证（任务冻结的用户 sk-）
     * @param imageUrl      源素材公网对象存储地址
     * @param expandTop     上方扩展比例（相对原图短边，[0, 0.4]）
     * @param expandBottom  下方扩展比例
     * @param expandLeft    左侧扩展比例
     * @param expandRight   右侧扩展比例
     * @return 结果图（火山托管 URL，仅 24h 有效，调用方须立即下载转存）
     * @throws ImageOutpaintError 按错误分类抛错
     */
    public OutpaintResult expandImageCanvas(String token, String imageUrl,
                                            double expandTop, double expandBottom,
                                            double expandLeft, double expandRight) {
        String traceId = UUID.randomUUID().toString();

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("image_url", imageUrl);
        payload.put("expand_top", expandTop);
        payload.put("expand_bottom", expandBottom);
        payload.put("expand_left", expandLeft);
        payload.put("expand_right", expandRight);
        // queue_id 不传：用火山系统默认队列（规格 Out of Scope：队列分账）

        Request.Builder requestBuilder;
        try {
            requestBuilder = new Request.Builder()
                    .url(baseUrl + EXPAND_PATH)
                    .post(RequestBody.create(JSON.writeValueAsString(payload), JSON_TYPE))
                    .header("Content-Type", "application/json");
        } catch (Exception e) {
            throw new ImageOutpaintError(ImageOutpaintContract.ERROR_IMAGE_OUTPAINT_FAILED,
                    "请求序列化失败");
        }
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        Request request = requestBuilder.build();

        Response response;
        try {
            response = httpClient.newCall(request).execute();
        } catch (java.net.SocketTimeoutException e) {
            // 超时统一终态不重试（无 worker 级自动重试；宁可不重试也不双跑）
            throw new ImageOutpaintError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "MediaKit 智能扩图超时");
        } catch (Exception e) {
            // 连接失败 / 其余 IO：请求可能未达上游，零扣费风险——仍归终态（无自动重试）
            throw new ImageOutpaintError(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit 智能扩图调用失败: " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }

        try (response) {
            ResponseBody body = response.body();
            String rawText = body != null ? body.string() : "";

            if (!response.isSuccessful()) {
                // 网关对 success=false / 未配价 / 缺渠道返 400 且不扣费——
                // 分类沿用 §5（content > quota > provider_failed），上游可读原因透传给前端投影。
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                String reason = extractUpstreamMessage(rawText);
                String message = "智能扩图失败: HTTP " + response.code();
                if (!reason.isEmpty()) {
                    message += " " + reason;
                } else {
                    message += " body=" + truncate(rawText);
                }
                throw new ImageOutpaintError(code, message);
            }

            JsonNode parsed;
            try {
                parsed = JSON.readTree(rawText);
            } catch (Exception e) {
                throw new ImageOutpaintError(ImageOutpaintContract.ERROR_IMAGE_OUTPAINT_FAILED,
                        "MediaKit 未返回有效 JSON");
            }

            JsonNode errorNode = parsed.get("error");
            if (errorNode != null && errorNode.has("message")) {
                String errText = errorNode.get("message").asText();
                String code = NewApiErrorClassifier.classifySuccessEnvelope(errText);
                throw new ImageOutpaintError(code, "MediaKit 智能扩图业务失败: " + truncate(errText));
            }

            JsonNode resultUrl = parsed.path("result").path("image_url");
            if (!resultUrl.isTextual() || resultUrl.asText().isEmpty()) {
                throw new ImageOutpaintError(ImageOutpaintContract.ERROR_IMAGE_OUTPAINT_FAILED,
                        "MediaKit 未返回结果图");
            }
            return new OutpaintResult(resultUrl.asText());
        } catch (ImageOutpaintError e) {
            throw e;
        } catch (Exception e) {
            throw new ImageOutpaintError(ImageOutpaintContract.ERROR_IMAGE_OUTPAINT_FAILED,
                    "MediaKit 响应读取失败: " + e.getMessage());
        }
    }

    // ========== 内部工具 ==========

    /**
     * 提取上游可读失败原因（网关 400 body 的 error.message 或顶层 message 字段）。
     * 供应商原因（如扩展比例超值域）透传给前端投影（用户故事 43）。
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
        String raw = System.getenv("NEW_API_IMAGE_OUTPAINT_TIMEOUT_MS");
        if (raw != null) {
            try {
                int n = Integer.parseInt(raw);
                if (n > 0) return n;
            } catch (NumberFormatException e) {
                log.debug("NEW_API_IMAGE_OUTPAINT_TIMEOUT_MS 解析失败，使用默认值: {}", e.getMessage());
            }
        }
        return DEFAULT_TIMEOUT_MS;
    }

    /**
     * 智能扩图结果：火山托管的结果图 URL（仅 24h 有效，processor 必须立即下载转存 TOS）。
     */
    public record OutpaintResult(String imageUrl) {}
}
