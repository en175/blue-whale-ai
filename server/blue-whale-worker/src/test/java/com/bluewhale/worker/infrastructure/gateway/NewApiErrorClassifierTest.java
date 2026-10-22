package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.error.GenerationError;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class NewApiErrorClassifierTest {


    @Test
    @DisplayName("copyright → content_rejected_reference(1038, IKFL53)")
    void copyright() {
        assertThat(NewApiErrorClassifier.classifyError("This content violates copyright policy", 400))
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);
    }

    @Test
    @DisplayName("敏感 → content_rejected（1018）")
    void sensitive_zh() {
        assertThat(NewApiErrorClassifier.classifyError("内容涉及敏感信息", 400))
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("版权 → content_rejected_reference(1038, IKFL53)")
    void copyright_zh() {
        assertThat(NewApiErrorClassifier.classifyError("涉及版权问题", 400))
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);
    }

    @Test
    @DisplayName("policyviolation → content_rejected（1018）")
    void policyViolation() {
        assertThat(NewApiErrorClassifier.classifyError("policyviolation detected", 400))
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("2048 上游原文（output video ... copyright restrictions）→ content_rejected_reference(1038, IKFL53)")
    void job2048CopyrightText() {
        assertThat(NewApiErrorClassifier.classifyError(
                "The request failed because the output video may be related to copyright restrictions. Request id: req-2048", 400))
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);
    }

    @Test
    @DisplayName("输入图敏感/真实人物（InputImageSensitiveContentDetected.PrivacyInformation）→ content_rejected(1018)")
    void inputImageSensitiveRealPerson() {
        assertThat(NewApiErrorClassifier.classifyError(
                "InputImageSensitiveContentDetected.PrivacyInformation: The request failed because the input image 'content[0]' may contain real person. Request id: req-1", 400))
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }


    @Test
    @DisplayName("HTTP 402 → platform_quota_exhausted")
    void http402() {
        assertThat(NewApiErrorClassifier.classifyError("", 402))
                .isEqualTo(GenerationError.ERROR_PLATFORM_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("余额不足 → platform_quota_exhausted")
    void balanceInsufficient_zh() {
        assertThat(NewApiErrorClassifier.classifyError("余额不足，请充值", 400))
                .isEqualTo(GenerationError.ERROR_PLATFORM_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("预扣费额度失败 → platform_quota_exhausted")
    void prechargeFailed_zh() {
        assertThat(NewApiErrorClassifier.classifyError("预扣费额度失败", 400))
                .isEqualTo(GenerationError.ERROR_PLATFORM_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("payment_required → platform_quota_exhausted")
    void paymentRequired() {
        assertThat(NewApiErrorClassifier.classifyError("payment_required", 400))
                .isEqualTo(GenerationError.ERROR_PLATFORM_QUOTA_EXHAUSTED);
    }


    @Test
    @DisplayName("无关错误 → provider_failed")
    void generic() {
        assertThat(NewApiErrorClassifier.classifyError("Internal Server Error", 500))
                .isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
    }

    @Test
    @DisplayName("空文本 + 非 402 → provider_failed")
    void emptyTextNon402() {
        assertThat(NewApiErrorClassifier.classifyError("", 500))
                .isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
    }


    @Test
    @DisplayName("优先级: 参考版权1038 > 输出/敏感1018（同时含版权+敏感 → 1038 优先，IKFL53）")
    void priorityCopyrightOverSensitive() {
        assertThat(NewApiErrorClassifier.classifyError("copyright violation 内容敏感", 402))
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);
    }

    @Test
    @DisplayName("优先级: content > quota（同时命中 content 和 quota 正则 → content_rejected 优先）")
    void priorityContentOverQuota() {
        assertThat(NewApiErrorClassifier.classifyError("copyright violation 余额不足", 402))
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);
    }


    @Test
    @DisplayName("classifySuccessEnvelope: content 优先于 quota")
    void envelopePriority() {
        assertThat(NewApiErrorClassifier.classifySuccessEnvelope("copyright violation 余额不足"))
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);
    }

    @Test
    @DisplayName("classifySuccessEnvelope: quota 信号 → platform_quota_exhausted")
    void envelopeQuota() {
        assertThat(NewApiErrorClassifier.classifySuccessEnvelope("剩余额度不足"))
                .isEqualTo(GenerationError.ERROR_PLATFORM_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("classifySuccessEnvelope: 无信号 → provider_failed")
    void envelopeFallback() {
        assertThat(NewApiErrorClassifier.classifySuccessEnvelope("boom"))
                .isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
    }


    @Test
    @DisplayName("isContentPolicySignal: null → false")
    void contentPolicyNull() {
        assertThat(NewApiErrorClassifier.isContentPolicySignal(null)).isFalse();
    }

    @Test
    @DisplayName("isQuotaSignal: null → false")
    void quotaNull() {
        assertThat(NewApiErrorClassifier.isQuotaSignal(null)).isFalse();
    }

    @Test
    @DisplayName("IKPPYX: Seedance 视频编辑英文正文 → isTaskTypeSignal 命中")
    void videoEditProseTaskTypeSignal() {
        assertThat(NewApiErrorClassifier.isTaskTypeSignal(
                "The parameters `ratio` and `duration` specified in the request are not valid. " +
                        "Seedance identified your task as video editing based on your prompt."))
                .isTrue();
        assertThat(NewApiErrorClassifier.isTaskTypeSignal(
                "Issues: [0] `ratio` must be `adaptive`. [1] `duration` must be -1."))
                .isTrue();
    }

    @Test
    @DisplayName("IKPPYX: 普通 InvalidParameter 不误判为任务类型约束")
    void videoEditProseNotMatched() {
        assertThat(NewApiErrorClassifier.isTaskTypeSignal(
                "InvalidParameter: The request parameter is not valid.")).isFalse();
        assertThat(NewApiErrorClassifier.isTaskTypeSignal("ratio must be 16:9")).isFalse();
        assertThat(NewApiErrorClassifier.isTaskTypeSignal(null)).isFalse();
    }
}
