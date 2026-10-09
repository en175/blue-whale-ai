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

    static final String ENHANCE_PATH = "/v1/mediakit/sync/enhance-image";

    static final String MODEL = "mediakit-enhance-image";

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

    public record EnhanceResult(String imageUrl) {}
}
