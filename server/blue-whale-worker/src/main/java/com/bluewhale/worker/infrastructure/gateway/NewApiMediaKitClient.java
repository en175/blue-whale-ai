package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.contract.ImageEnhanceContract;
import com.bluewhale.worker.domain.error.ImageEnhanceError;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * new-api 网关 MediaKit 图像画质增强客户端（契约 §14.5 / IKGM9D；MediaKit 家族首个
 * 同步客户端，后续同步族均以其为模板——HTTP 骨架自 IKHKMK 起收敛入
 * {@link NewApiMediaKitSyncClient}，本类只保留出站 payload 构造与超时变化轴）。
 * <p>
 * 端点：{@code POST {NEW_API_BASE_URL}/v1/mediakit/sync/enhance-image}（网关同步路由，
 * 本仓不直连火山、不新增凭证配置项——渠道与上游 API Key 在网关侧配置）。
 * 请求体为 MediaKit 原生参数，网关原样透传；model 字段为对客模型名
 * {@code mediakit-enhance-image}（网关按模型名路由 MediaKit 渠道并计次计费，本期 model_price 配 0）。
 * <p>
 * 鉴权与图片生成同构（契约 §5 / ADR-0080）：Authorization: Bearer 任务冻结的用户 sk-（由
 * processor 从 job.input.provider_credential 取出传入）+ X-Trace-Id + X-Client-System: bluewhale。
 * <p>
 * 请求映射（契约 §14.3，单处定义 = ImageEnhanceContract）：
 * <ul>
 *   <li>image_url：源素材公网对象存储地址（Asset url 落库即 public-read，无需签名改造）</li>
 *   <li>tool_version：lite→standard / pro→professional / max→max（processor 换算后传入）</li>
 *   <li>multiple：原样透传</li>
 *   <li>generative_enhance_mode / enable_correct_color：仅当版本档支持时由 processor 传入
 *       （能力矩阵裁剪，TIERS_WITH_ENHANCE_MODE / TIERS_WITH_CORRECT_COLOR），
 *       本类按「null 即不发键」裁剪</li>
 * </ul>
 * <p>
 * 响应：网关原样透传火山同步响应，结果图地址在 {@code result.image_url}
 * （URL 仅 24h 有效，processor 须立即下载转存）。网关对 success=false 返 400 且不扣费。
 * <p>
 * 错误分类复用 NewApiErrorClassifier（content > quota > provider_failed，§5 优先级）；
 * 其余（超时 / 供应商失败 / 无结果）由 processor 归并兜底码 image_enhance_failed（§14.5）。
 */
@Component
public class NewApiMediaKitClient extends NewApiMediaKitSyncClient {

    private static final Logger log = LoggerFactory.getLogger(NewApiMediaKitClient.class);

    /** 网关同步路由路径（blue-whale-api 网关侧 MediaKit 渠道）。 */
    static final String ENHANCE_PATH = "/v1/mediakit/sync/enhance-image";

    /** 对客模型名（契约 §14.5：网关渠道路由 + model_price 配 0 免费口径）。 */
    static final String MODEL = "mediakit-enhance-image";

    /**
     * 默认读超时 300s（同步 enhance 实测秒级返回，但取与图片生成同窗口的保守值；
     * env NEW_API_IMAGE_ENHANCE_TIMEOUT_MS 可覆盖）。配套：claim 租约 420s（JobClaimService），
     * 必须 > 超时 + 下载转存余量，否则 recovery 把在跑任务当孤儿重投 → 双跑。
     */
    private static final int DEFAULT_TIMEOUT_MS = 300_000;

    public NewApiMediaKitClient() {
        this(System.getenv("NEW_API_BASE_URL"));
    }

    /** 测试用构造器：注入 base URL，超时走 env/默认。 */
    NewApiMediaKitClient(String baseUrl) {
        this(baseUrl, loadTimeoutMs());
    }

    /** 测试用构造器：注入读/写超时（毫秒）。 */
    NewApiMediaKitClient(String baseUrl, int timeoutMs) {
        super(baseUrl, timeoutMs);
    }

    @Override
    protected String syncPath() {
        return ENHANCE_PATH;
    }

    @Override
    protected String taskLabel() {
        return "高清放大";
    }

    @Override
    protected String fallbackCode() {
        return ImageEnhanceContract.ERROR_IMAGE_ENHANCE_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new ImageEnhanceError(code, message);
    }

    /**
     * 提交图像画质增强（同步接口）。
     *
     * @param token                 per-job Bearer 凭证（任务冻结的用户 sk-）
     * @param imageUrl              源素材公网对象存储地址
     * @param toolVersion           火山 tool_version（standard / professional / max，§14.3 映射）
     * @param multiple              放大倍数（2/4/6）
     * @param generativeEnhanceMode 增强策略；null = 当前版本档不支持（出站裁剪不发键）
     * @param enableCorrectColor    色彩校正开关；null = 当前版本档不支持（出站裁剪不发键）
     * @return 结果图（火山托管 URL，仅 24h 有效，调用方须立即下载转存）
     * @throws ImageEnhanceError 按错误分类抛错
     */
    public EnhanceResult enhance(String token, String imageUrl, String toolVersion, int multiple,
                                 String generativeEnhanceMode, Boolean enableCorrectColor) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("image_url", imageUrl);
        payload.put("tool_version", toolVersion);
        payload.put("multiple", multiple);
        if (generativeEnhanceMode != null) {
            payload.put("generative_enhance_mode", generativeEnhanceMode);
        }
        if (enableCorrectColor != null) {
            payload.put("enable_correct_color", enableCorrectColor);
        }
        return new EnhanceResult(requireResultImageUrl(executeSyncPost(token, payload)));
    }

    private static int loadTimeoutMs() {
        String raw = System.getenv("NEW_API_IMAGE_ENHANCE_TIMEOUT_MS");
        if (raw != null) {
            try {
                int n = Integer.parseInt(raw);
                if (n > 0) return n;
            } catch (NumberFormatException e) {
                log.debug("NEW_API_IMAGE_ENHANCE_TIMEOUT_MS 解析失败，使用默认值: {}", e.getMessage());
            }
        }
        return DEFAULT_TIMEOUT_MS;
    }

    /**
     * 画质增强结果：火山托管的结果图 URL（仅 24h 有效，processor 必须立即下载转存 TOS）。
     */
    public record EnhanceResult(String imageUrl) {}
}
