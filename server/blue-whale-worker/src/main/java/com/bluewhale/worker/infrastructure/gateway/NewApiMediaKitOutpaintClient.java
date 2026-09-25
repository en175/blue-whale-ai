package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig;
import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.ImageOutpaintContract;
import com.bluewhale.worker.domain.error.ImageOutpaintError;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * new-api 网关 MediaKit 智能扩图客户端（IKGOQW，以 NewApiMediaKitClient 为模板；HTTP
 * 骨架自 IKHKMK 起收敛入 {@link NewApiMediaKitSyncClient}，本类只保留出站 payload
 * 构造与超时变化轴）。
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
public class NewApiMediaKitOutpaintClient extends NewApiMediaKitSyncClient {

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

    public NewApiMediaKitOutpaintClient(UpstreamBaseUrl baseUrl) {
        super(baseUrl, loadTimeoutMs());
    }

    @Override
    protected String syncPath() {
        return EXPAND_PATH;
    }

    @Override
    protected String taskLabel() {
        return "智能扩图";
    }

    @Override
    protected String fallbackCode() {
        return ImageOutpaintContract.ERROR_IMAGE_OUTPAINT_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new ImageOutpaintError(code, message);
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
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("image_url", imageUrl);
        payload.put("expand_top", expandTop);
        payload.put("expand_bottom", expandBottom);
        payload.put("expand_left", expandLeft);
        payload.put("expand_right", expandRight);
        // queue_id 不传：用火山系统默认队列（规格 Out of Scope：队列分账）
        return new OutpaintResult(requireResultImageUrl(executeSyncPost(token, payload)));
    }

    private static int loadTimeoutMs() {
        return NewApiUpstreamConfig.timeoutMs("NEW_API_IMAGE_OUTPAINT_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
    }

    /**
     * 智能扩图结果：火山托管的结果图 URL（仅 24h 有效，processor 必须立即下载转存 TOS）。
     */
    public record OutpaintResult(String imageUrl) {}
}
