package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig;
import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.ImageEraseContract;
import com.bluewhale.worker.domain.error.ImageEraseError;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class NewApiMediaKitEraseClient extends NewApiMediaKitSyncClient {

    /** 网关同步路由路径（blue-whale-api 网关侧 MediaKit 渠道）。 */
    static final String ERASE_PATH = "/v1/mediakit/sync/erase-image";

    /** 对客模型名（契约 §15.5：网关渠道路由 + model_price 配 0 免费口径）。 */
    static final String MODEL = "mediakit-erase-image";

    /**
     * 默认读超时 300s（同步 erase 实测秒级返回，取与高清放大同窗口的保守值；
     * env NEW_API_IMAGE_ERASE_TIMEOUT_MS 可覆盖）。配套：claim 租约 420s（JobClaimService），
     * 必须 > 超时 + 下载转存余量，否则 recovery 把在跑任务当孤儿重投 → 双跑。
     */
    private static final int DEFAULT_TIMEOUT_MS = 300_000;

    public NewApiMediaKitEraseClient(UpstreamBaseUrl baseUrl) {
        super(baseUrl, loadTimeoutMs());
    }

    @Override
    protected String syncPath() {
        return ERASE_PATH;
    }

    @Override
    protected String taskLabel() {
        return "图片擦除";
    }

    @Override
    protected String fallbackCode() {
        return ImageEraseContract.ERROR_IMAGE_ERASE_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new ImageEraseError(code, message);
    }

    public EraseResult erase(String token, String imageUrl, String standardScene, String maskUrl) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("image_url", imageUrl);
        payload.put("tool_version", ImageEraseContract.TOOL_VERSION);
        payload.put("standard_scene", standardScene);
        if (maskUrl != null) {
            payload.put("mask_url", maskUrl);
        }
        payload.put("output_format", ImageEraseContract.OUTPUT_FORMAT);
        return new EraseResult(requireResultImageUrl(executeSyncPost(token, payload)));
    }

    private static int loadTimeoutMs() {
        return NewApiUpstreamConfig.timeoutMs("NEW_API_IMAGE_ERASE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
    }

    /**
     * 图片擦除结果：火山托管的结果图 URL（仅 24h 有效，processor 必须立即下载转存 TOS）。
     */
    public record EraseResult(String imageUrl) {}
}
