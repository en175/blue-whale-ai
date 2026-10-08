package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig;
import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.ImageCutoutContract;
import com.bluewhale.worker.domain.error.ImageCutoutError;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class NewApiMediaKitCutoutClient extends NewApiMediaKitSyncClient {

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

    public NewApiMediaKitCutoutClient(UpstreamBaseUrl baseUrl) {
        super(baseUrl, loadTimeoutMs());
    }

    @Override
    protected String syncPath() {
        return CUTOUT_PATH;
    }

    @Override
    protected String taskLabel() {
        return "图片抠图";
    }

    @Override
    protected String fallbackCode() {
        return ImageCutoutContract.ERROR_IMAGE_CUTOUT_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new ImageCutoutError(code, message);
    }

    public CutoutResult cutout(String token, String imageUrl, String scene,
                               Boolean needContour, String contourColor, Integer contourSize,
                               Boolean needCropBackground) {
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

        JsonNode parsed = executeSyncPost(token, payload);
        String resultUrl = requireResultImageUrl(parsed);
        // 官方响应自带宽高（result.image_width/image_height）；缺失/非数值时置 null，
        // processor 以结果图 ImageIO 解析兜底（契约 §8 静默 null 等价标准）。
        JsonNode widthNode = parsed.path("result").path("image_width");
        JsonNode heightNode = parsed.path("result").path("image_height");
        Integer width = widthNode.isNumber() && widthNode.canConvertToInt()
                ? widthNode.asInt() : null;
        Integer height = heightNode.isNumber() && heightNode.canConvertToInt()
                ? heightNode.asInt() : null;
        return new CutoutResult(resultUrl, width, height);
    }

    private static int loadTimeoutMs() {
        return NewApiUpstreamConfig.timeoutMs("NEW_API_IMAGE_CUTOUT_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
    }

    /**
     * 图片抠图结果：火山托管的结果图 URL（仅 24h 有效，processor 必须立即下载转存 TOS）
     * 与官方响应宽高（可 null，缺失时 processor 以 ImageIO 兜底）。
     */
    public record CutoutResult(String imageUrl, Integer imageWidth, Integer imageHeight) {}
}
