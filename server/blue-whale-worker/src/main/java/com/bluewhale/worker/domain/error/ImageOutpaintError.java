package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.ImageOutpaintContract;

/**
 * 智能扩图供应商错误（IKGOQW）。
 * <p>
 * 按 code 落 error JSON。content / quota 类信号沿用 NewApiErrorClassifier 分类
 * （契约 §5 优先级不变），其余一律在处理器归并兜底码
 * {@link ImageOutpaintContract#ERROR_IMAGE_OUTPAINT_FAILED}
 * （无 worker 级自动重试，用户在结果卡手动重试并沿用冻结 input）。
 */
public class ImageOutpaintError extends RuntimeException {

    private final String code;

    public ImageOutpaintError(String code, String message) {
        super(message);
        this.code = code;
    }

    public ImageOutpaintError(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
