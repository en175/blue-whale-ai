package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig;
import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.ImageOutpaintContract;
import com.bluewhale.worker.domain.error.ImageOutpaintError;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

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
