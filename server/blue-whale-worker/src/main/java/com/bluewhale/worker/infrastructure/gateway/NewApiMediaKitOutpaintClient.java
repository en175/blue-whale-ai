package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.ImageOutpaintContract;
import com.bluewhale.worker.domain.error.ImageOutpaintError;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class NewApiMediaKitOutpaintClient extends NewApiMediaKitSyncClient {

    static final String EXPAND_PATH = "/v1/mediakit/sync/expand-image-canvas";

    static final String MODEL = "mediakit-expand-image-canvas";

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
        return new OutpaintResult(requireResultImageUrl(executeSyncPost(token, payload)));
    }

    private static int loadTimeoutMs() {
        return NewApiUpstreamConfig.timeoutMs("NEW_API_IMAGE_OUTPAINT_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
    }

    public record OutpaintResult(String imageUrl) {}
}
