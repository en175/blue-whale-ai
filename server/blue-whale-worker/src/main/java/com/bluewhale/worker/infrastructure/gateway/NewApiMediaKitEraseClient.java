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

    static final String ERASE_PATH = "/v1/mediakit/sync/erase-image";

    static final String MODEL = "mediakit-erase-image";

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

    public record EraseResult(String imageUrl) {}
}
