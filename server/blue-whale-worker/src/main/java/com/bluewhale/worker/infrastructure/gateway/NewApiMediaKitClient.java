package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig;
import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.ImageEnhanceContract;
import com.bluewhale.worker.domain.error.ImageEnhanceError;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class NewApiMediaKitClient extends NewApiMediaKitSyncClient {

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

    public NewApiMediaKitClient(UpstreamBaseUrl baseUrl) {
        super(baseUrl, loadTimeoutMs());
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
        return NewApiUpstreamConfig.timeoutMs("NEW_API_IMAGE_ENHANCE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
    }

    /**
     * 画质增强结果：火山托管的结果图 URL（仅 24h 有效，processor 必须立即下载转存 TOS）。
     */
    public record EnhanceResult(String imageUrl) {}
}
