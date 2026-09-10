package com.bluewhale.worker.domain.error;

/**
 * 生成域错误码常量（packages/contracts/src/error-codes.ts:20-70 逐字移植）。
 * <p>
 * 字符串码为权威值（job.error.code 写字符串，契约 §6）。
 * Java 侧从本契约文档生成常量表，禁止手抄新增（契约 §6）。
 */
public final class GenerationError {

    private GenerationError() {}

    // ---- 1xxx 生成域（error-codes.ts:20-70） ----

    /** 未知回退数值 1000（契约 §6）。 */
    public static final String UNKNOWN = "unknown";

    /** 额度耗尽（HTTP 402 / 文案正则，§5 优先级不变）。 */
    public static final String ERROR_QUOTA_EXHAUSTED = "quota_exhausted";

    /** 供应商凭证缺失（generation-worker.ts:370/502）。 */
    public static final String ERROR_PROVIDER_CREDENTIAL_MISSING = "provider_credential_missing";

    /** 模型不可用（generation-worker.ts:381）。 */
    public static final String ERROR_MODEL_UNAVAILABLE = "model_unavailable";

    /** 参考素材不可用（generation-worker.ts:395）。 */
    public static final String ERROR_REFERENCE_ASSET_UNAVAILABLE = "reference_asset_unavailable";

    /** 输入无效（generation-worker.ts:303）。 */
    public static final String ERROR_INVALID_INPUT = "invalid_input";

    /** 参考素材无效。 */
    public static final String ERROR_INVALID_REFERENCE = "invalid_reference";

    /** 参考类型无效。 */
    public static final String ERROR_INVALID_REFERENCE_TYPE = "invalid_reference_type";

    /** 不支持的类型（generation-worker.ts:288）。 */
    public static final String ERROR_UNSUPPORTED_TYPE = "unsupported_type";

    /** 不支持的输入。 */
    public static final String ERROR_UNSUPPORTED_INPUT = "unsupported_input";

    /** 无结果（generation-worker.ts:600/140）。 */
    public static final String ERROR_NO_RESULT = "no_result";

    /** 供应商失败（兜底）。 */
    public static final String ERROR_PROVIDER_FAILED = "provider_failed";

    /** 供应商超时（new-api-audio-provider.ts:101）。 */
    public static final String ERROR_PROVIDER_TIMEOUT = "provider_timeout";

    /** 内容策略拒绝（copyright/sensitive 优先，§5）。 */
    public static final String ERROR_CONTENT_REJECTED = "content_rejected";

    /** 供应商配置错误。 */
    public static final String ERROR_PROVIDER_CONFIG = "provider_config";

    /** 参考媒体无效（video-reference-validation.ts：mime/size/duration/dimensions 不合规）。 */
    public static final String ERROR_INVALID_REFERENCE_MEDIA = "invalid_reference_media";

    /** 参考素材超量（video-reference-validation.ts：图片 >9 / 视频 >3 / 音频 >3）。 */
    public static final String ERROR_REFERENCE_LIMIT_EXCEEDED = "reference_limit_exceeded";
}
