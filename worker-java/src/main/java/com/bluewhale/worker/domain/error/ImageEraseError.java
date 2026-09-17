package com.bluewhale.worker.domain.error;

/**
 * 图片擦除供应商错误（契约 §15 / IKGOT6）。
 * <p>
 * 按 code 落 error JSON。content / quota 类信号沿用 NewApiErrorClassifier 分类
 * （契约 §5 优先级不变），其余一律在处理器归并兜底码
 * {@link com.bluewhale.worker.domain.entity.ImageEraseContract#ERROR_IMAGE_ERASE_FAILED}
 * （无 worker 级自动重试，§15.5）。
 */
public class ImageEraseError extends RuntimeException {

    private final String code;

    public ImageEraseError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
