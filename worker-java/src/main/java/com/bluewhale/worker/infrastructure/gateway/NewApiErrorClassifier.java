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
     * 版权拒绝信号正则（IKFL53：copyright/版权 原因 → 1038「参考内容可能涉及版权限制」）。
     * 用户口径：上游 copyright-restrictions 原因独立成「参考内容可能涉及版权限制」（对外文案如此），
     * 与「生成内容未通过安全审核」（sensitive/敏感/审核 类 → 1018）按关键词分开。
     * 注意：本正则不要求出现"参考"字样——按关键词 copyright/版权 判定，非「参考 vs 输出」区分。
     */
    private static final Pattern COPYRIGHT_PATTERN = Pattern.compile(
            "copyright|版权",
            Pattern.CASE_INSENSITIVE
    );

    /**
     * 内容策略正则（error-codes.ts isContentPolicySignal）。
     * 与 TS 逐字一致：/(copyright|sensitive|版权|敏感|policy violation|policyviolation|content policy)/i
     * IKFL53：版权信号（1038）先于敏感/审核 1018 判定；sensitive/敏感/policy violation 走 1018。
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
     * 优先级：版权 1038 > 输出/敏感 1018 > quota > provider_failed。
     */
    public static String classifyError(String text, int httpStatus) {
        if (isCopyrightSignal(text)) {
            return GenerationError.ERROR_CONTENT_REJECTED_REFERENCE;
        }
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
     * 优先级：版权 1038 > 输出/敏感 1018 > quota > provider_failed。
     */
    public static String classifySuccessEnvelope(String errorText) {
        if (isCopyrightSignal(errorText)) {
            return GenerationError.ERROR_CONTENT_REJECTED_REFERENCE;
        }
        if (isContentPolicySignal(errorText)) {
            return GenerationError.ERROR_CONTENT_REJECTED;
        }
        if (isQuotaSignal(errorText)) {
            return GenerationError.ERROR_QUOTA_EXHAUSTED;
        }
        return GenerationError.ERROR_PROVIDER_FAILED;
    }

    /**
     * 版权拒绝信号（IKFL53）：copyright/版权 → 1038「参考内容可能涉及版权限制」。
     * 对外文案用「参考内容」字样是产品口径，判定仅按 copyright/版权 关键词，不要求参考字样。
     */
    public static boolean isCopyrightSignal(String text) {
        return text != null && COPYRIGHT_PATTERN.matcher(text).find();
    }

    public static boolean isContentPolicySignal(String text) {
        return text != null && CONTENT_POLICY_PATTERN.matcher(text).find();
    }

    public static boolean isQuotaSignal(String text) {
        return text != null && QUOTA_PATTERN.matcher(text).find();
    }
}
