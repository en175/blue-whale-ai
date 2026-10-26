package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.error.GenerationError;

import java.util.regex.Pattern;

public final class NewApiErrorClassifier {

    private NewApiErrorClassifier() {}

    private static final Pattern COPYRIGHT_PATTERN = Pattern.compile(
            "copyright|版权",
            Pattern.CASE_INSENSITIVE
    );

    private static final Pattern CONTENT_POLICY_PATTERN = Pattern.compile(
            "copyright|sensitive|版权|敏感|policy violation|policyviolation|content policy",
            Pattern.CASE_INSENSITIVE
    );

    private static final Pattern QUOTA_PATTERN = Pattern.compile(
            "预扣费额度失败|剩余额度|余额不足|额度不足|balance|payment_required",
            Pattern.CASE_INSENSITIVE
    );

    private static final Pattern OUTPUT_AUDIO_COPYRIGHT_PATTERN = Pattern.compile(
            "OutputAudioSensitiveContentDetected|output audio",
            Pattern.CASE_INSENSITIVE
    );

    private static final Pattern TASK_TYPE_PATTERN = Pattern.compile(
            "TaskTypeMismatch|TaskTypeConstraint",
            Pattern.CASE_INSENSITIVE
    );

    private static final Pattern VIDEO_EDIT_TASK_PROSE_PATTERN = Pattern.compile(
            "identified your task as video editing",
            Pattern.CASE_INSENSITIVE
    );

    private static final Pattern VIDEO_EDIT_RATIO_PATTERN = Pattern.compile(
            "`?ratio`?\\s+must\\s+be\\s+`?adaptive`?",
            Pattern.CASE_INSENSITIVE
    );

    private static final Pattern VIDEO_EDIT_DURATION_PATTERN = Pattern.compile(
            "`?duration`?\\s+must\\s+be\\s+`?-1`?\\b",
            Pattern.CASE_INSENSITIVE
    );

    public static String classifyError(String text, int httpStatus) {
        if (isCopyrightSignal(text)) {
            return GenerationError.ERROR_CONTENT_REJECTED_REFERENCE;
        }
        if (isContentPolicySignal(text)) {
            return GenerationError.ERROR_CONTENT_REJECTED;
        }
        if (httpStatus == 402 || isQuotaSignal(text)) {
            return GenerationError.ERROR_PLATFORM_QUOTA_EXHAUSTED;
        }
        return GenerationError.ERROR_PROVIDER_FAILED;
    }

    public static String classifySuccessEnvelope(String errorText) {
        if (isCopyrightSignal(errorText)) {
            return GenerationError.ERROR_CONTENT_REJECTED_REFERENCE;
        }
        if (isContentPolicySignal(errorText)) {
            return GenerationError.ERROR_CONTENT_REJECTED;
        }
        if (isQuotaSignal(errorText)) {
            return GenerationError.ERROR_PLATFORM_QUOTA_EXHAUSTED;
        }
        return GenerationError.ERROR_PROVIDER_FAILED;
    }

    public static boolean isCopyrightSignal(String text) {
        return text != null && COPYRIGHT_PATTERN.matcher(text).find();
    }

    public static boolean isContentPolicySignal(String text) {
        return text != null && CONTENT_POLICY_PATTERN.matcher(text).find();
    }

    public static boolean isQuotaSignal(String text) {
        return text != null && QUOTA_PATTERN.matcher(text).find();
    }

    public static boolean isOutputAudioCopyrightSignal(String text) {
        return text != null && OUTPUT_AUDIO_COPYRIGHT_PATTERN.matcher(text).find();
    }

    public static boolean isTaskTypeSignal(String text) {
        if (text == null) return false;
        if (TASK_TYPE_PATTERN.matcher(text).find()) return true;
        if (VIDEO_EDIT_TASK_PROSE_PATTERN.matcher(text).find()) return true;
        return VIDEO_EDIT_RATIO_PATTERN.matcher(text).find()
                && VIDEO_EDIT_DURATION_PATTERN.matcher(text).find();
    }
}
