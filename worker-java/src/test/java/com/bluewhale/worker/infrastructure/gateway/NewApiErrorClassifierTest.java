package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.error.GenerationError;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * new-api 共享错误分类表测试（new-api-audio-provider.ts:119-163 + §5 IKDAJN 逐字移植）。
 * <p>
 * 本测试原挂于 NewApiAudioClient（刀②影子实现）；audio 分类收敛到共享
 * {@link NewApiErrorClassifier} 后随迁至此——图片/音频/视频三路共用同一分类真值表。
 * <p>
 * 优先级：content_rejected > quota_exhausted > provider_failed。
 * 中文正则与 TS error-codes.ts isContentPolicySignal / isQuotaSignal 逐字一致。
 */
class NewApiErrorClassifierTest {

    // ---- content_rejected（最高优先级） ----

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
        // IKFL53：输入图含真实人物/隐私信息 → 安全审核 1018（非版权 1038）
        assertThat(NewApiErrorClassifier.classifyError(
                "InputImageSensitiveContentDetected.PrivacyInformation: The request failed because the input image 'content[0]' may contain real person. Request id: req-1", 400))
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    // ---- quota_exhausted（中优先级） ----

    @Test
    @DisplayName("HTTP 402 → quota_exhausted")
    void http402() {
        assertThat(NewApiErrorClassifier.classifyError("", 402))
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("余额不足 → quota_exhausted")
    void balanceInsufficient_zh() {
        assertThat(NewApiErrorClassifier.classifyError("余额不足，请充值", 400))
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("预扣费额度失败 → quota_exhausted")
    void prechargeFailed_zh() {
        assertThat(NewApiErrorClassifier.classifyError("预扣费额度失败", 400))
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("payment_required → quota_exhausted")
    void paymentRequired() {
        assertThat(NewApiErrorClassifier.classifyError("payment_required", 400))
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    // ---- provider_failed（兜底） ----

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

    // ---- 优先级验证 ----

    @Test
    @DisplayName("优先级: 参考版权1038 > 输出/敏感1018（同时含版权+敏感 → 1038 优先，IKFL53）")
    void priorityCopyrightOverSensitive() {
        // 同时包含 copyright 和 sensitive → copyright 1038 优先于敏感 1018
        assertThat(NewApiErrorClassifier.classifyError("copyright violation 内容敏感", 402))
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);
    }

    @Test
    @DisplayName("优先级: content > quota（同时命中 content 和 quota 正则 → content_rejected 优先）")
    void priorityContentOverQuota() {
        // 同时包含 copyright 和 余额不足 → 1038 优先（copyright 先判）
        assertThat(NewApiErrorClassifier.classifyError("copyright violation 余额不足", 402))
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);
    }

    // ---- 成功态错误信封（无 HTTP 状态入参，content > quota > provider_failed） ----

    @Test
    @DisplayName("classifySuccessEnvelope: content 优先于 quota")
    void envelopePriority() {
        assertThat(NewApiErrorClassifier.classifySuccessEnvelope("copyright violation 余额不足"))
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);
    }

    @Test
    @DisplayName("classifySuccessEnvelope: quota 信号 → quota_exhausted")
    void envelopeQuota() {
        assertThat(NewApiErrorClassifier.classifySuccessEnvelope("剩余额度不足"))
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("classifySuccessEnvelope: 无信号 → provider_failed")
    void envelopeFallback() {
        assertThat(NewApiErrorClassifier.classifySuccessEnvelope("boom"))
                .isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
    }

    // ---- 信号谓词 null 安全 ----

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
}
