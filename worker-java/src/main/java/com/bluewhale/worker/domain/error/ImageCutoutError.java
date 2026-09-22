package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.ImageCutoutContract;

/**
 * 图片抠图供应商错误（契约章节 docs/specs/2026-09-18-image-cutout-mediakit.md / IKGXM2）。
 * <p>
 * 按 code 落 error JSON。content / quota 类信号沿用 NewApiErrorClassifier 分类
 * （契约 §5 优先级不变），其余一律在处理器归并兜底码
 * {@link ImageCutoutContract#ERROR_IMAGE_CUTOUT_FAILED}
 * （无 worker 级自动重试）。
 */
public class ImageCutoutError extends RuntimeException {

    private final String code;

    public ImageCutoutError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
