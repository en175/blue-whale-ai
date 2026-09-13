package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.error.GenerationError;

import java.util.regex.Pattern;

/**
 * new-api 错误分类（error-codes.ts 共用正则 + §5 IKDAJN 优先级）。
 * <p>
 * 图片/音频/视频三路客户端共用同一套分类逻辑（content > quota > provider_failed）。
 * 从 NewApiAudioClient 提取（blade-② 已有等价实现，此处抽取为共享工具类）。
 * <p>
 * 优先级（§5 / IKDAJN）：content_rejected > quota_exhausted > provider_failed。
 */
public final class NewApiErrorClassifier {

    private NewApiErrorClassifier() {}

    /**
     * 内容策略正则（error-codes.ts isContentPolicySignal）。
     * 与 TS 逐字一致：/(copyright|sensitive|版权|敏感|policy violation|policyviolation|content policy)/i
     */
    private static final Pattern CONTENT_POLICY_PATTERN = Pattern.compile(
            "copyright|sensitive|版权|敏感|policy violation|policyviolation|content policy",
            Pattern.CASE_INSENSITIVE
    );

    /**
     * 额度信号正则（error-codes.ts isQuotaSignal）。
     * 与 TS 逐字一致：/(预扣费额度失败|剩余额度|余额不足|额度不足|balance|payment_required)/i
     */
    private static final Pattern QUOTA_PATTERN = Pattern.compile(
            "预扣费额度失败|剩余额度|余额不足|额度不足|balance|payment_required",
            Pattern.CASE_INSENSITIVE
    );

    /**
     * 非 2xx 错误分类（new-api-audio-provider.ts:119-130 + §5 IKDAJN）。
     * 优先级：content > quota > provider_failed。
     */
    public static String classifyError(String text, int httpStatus) {
        if (isContentPolicySignal(text)) {
            return GenerationError.ERROR_CONTENT_REJECTED;
        }
        if (httpStatus == 402 || isQuotaSignal(text)) {
            return GenerationError.ERROR_QUOTA_EXHAUSTED;
        }
        return GenerationError.ERROR_PROVIDER_FAILED;
    }

    /**
     * 成功态 error 信封分类（new-api-audio-provider.ts:142-163 + 图片 provider 同构）。
     * 优先级：content > quota > provider_failed。
     */
    public static String classifySuccessEnvelope(String errorText) {
        if (isContentPolicySignal(errorText)) {
            return GenerationError.ERROR_CONTENT_REJECTED;
        }
        if (isQuotaSignal(errorText)) {
            return GenerationError.ERROR_QUOTA_EXHAUSTED;
        }
        return GenerationError.ERROR_PROVIDER_FAILED;
    }

    public static boolean isContentPolicySignal(String text) {
        return text != null && CONTENT_POLICY_PATTERN.matcher(text).find();
    }

    public static boolean isQuotaSignal(String text) {
        return text != null && QUOTA_PATTERN.matcher(text).find();
    }
}
