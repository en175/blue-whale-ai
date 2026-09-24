package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.VocalSplitContract;

/**
 * 人声背景分离（vocal_split）可预期错误（IKHA2C，契约 =
 * backend/libs/contracts/vocal-split.ts）。
 * <p>
 * 按 code 落 error JSON。分类信号（额度/内容/版权/provider_failed/提交超时）沿用
 * NewApiErrorClassifier 既有通用码（契约 §5 优先级不变），其余一律在处理器归并兜底码
 * {@link VocalSplitContract#ERROR_VOCAL_SPLIT_FAILED}
 * （数值 1047——1046 已被先合入的场景切分 !789 占用；无 worker 级自动重试，
 * 用户在任务占位卡手动重试沿用冻结 input）。
 */
public class VocalSplitError extends RuntimeException {

    private final String code;

    public VocalSplitError(String code, String message) {
        super(message);
        this.code = code;
    }

    public VocalSplitError(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
