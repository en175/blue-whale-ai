package com.bluewhale.worker.domain.error;

/**
 * 人声背景分离（vocal_split）可预期错误（IKHA2C，契约 =
 * backend/libs/contracts/vocal-split.ts）。
 * <p>
 * 按 code 落 error JSON，不判为系统失败。错误码定义于
 * backend/libs/contracts/error-codes.ts（数值表 GENERATION_ERROR_NUMERIC_CODES）。
 */
public class VocalSplitError extends RuntimeException {

    /** IKHA2C：执行兜底失败码（数值 1046）——网关分类链（额度/内容/版权/provider_failed/
     *  提交超时，复用既有通用码）之外的火山任务失败（轮询 status=failed）与转存失败
     *  （result 各轨 URL 24h 临时链接 → 自家 TOS）统一归并本码，无 worker 级重试。 */
    public static final String VOCAL_SPLIT_FAILED = "vocal_split_failed";

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
