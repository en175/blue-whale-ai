package com.bluewhale.worker.domain.error;

/**
 * 高清放大供应商错误（契约 §14 / IKGM9D）。
 * <p>
 * 按 code 落 error JSON。content / quota 类信号沿用 NewApiErrorClassifier 分类
 * （契约 §5 优先级不变），其余一律在处理器归并兜底码
 * {@link com.bluewhale.worker.domain.entity.ImageEnhanceContract#ERROR_IMAGE_ENHANCE_FAILED}
 * （无 worker 级自动重试，§14.5）。
 */
public class ImageEnhanceError extends RuntimeException {

    private final String code;

    public ImageEnhanceError(String code, String message) {
        super(message);
        this.code = code;
    }

    public ImageEnhanceError(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
