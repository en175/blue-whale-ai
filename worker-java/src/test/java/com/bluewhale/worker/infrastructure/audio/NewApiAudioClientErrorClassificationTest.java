package com.bluewhale.worker.infrastructure.audio;

import com.bluewhale.worker.domain.error.GenerationError;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * TTS 错误分类表测试（new-api-audio-provider.ts:119-163 + §5 逐字移植）。
 * <p>
 * 优先级：content_rejected > quota_exhausted > provider_failed（IKDAJN）。
 * 中文正则与 TS error-codes.ts isContentPolicySignal / isQuotaSignal 逐字一致。
 */
class NewApiAudioClientErrorClassificationTest {

    private final NewApiAudioClient client = new TestableAudioClient();

    // ---- content_rejected（最高优先级） ----

    @Test
    @DisplayName("copyright → content_rejected")
    void copyright() {
        assertThat(client.classifyError("This content violates copyright policy", 400))
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("敏感 → content_rejected")
    void sensitive_zh() {
        assertThat(client.classifyError("内容涉及敏感信息", 400))
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("版权 → content_rejected")
    void copyright_zh() {
        assertThat(client.classifyError("涉及版权问题", 400))
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("policyviolation → content_rejected")
    void policyViolation() {
        assertThat(client.classifyError("policyviolation detected", 400))
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    // ---- quota_exhausted（中优先级） ----

    @Test
    @DisplayName("HTTP 402 → quota_exhausted")
    void http402() {
        assertThat(client.classifyError("", 402))
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("余额不足 → quota_exhausted")
    void balanceInsufficient_zh() {
        assertThat(client.classifyError("余额不足，请充值", 400))
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("预扣费额度失败 → quota_exhausted")
    void prechargeFailed_zh() {
        assertThat(client.classifyError("预扣费额度失败", 400))
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("payment_required → quota_exhausted")
    void paymentRequired() {
        assertThat(client.classifyError("payment_required", 400))
                .isEqualTo(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    // ---- provider_failed（兜底） ----

    @Test
    @DisplayName("无关错误 → provider_failed")
    void generic() {
        assertThat(client.classifyError("Internal Server Error", 500))
                .isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
    }

    @Test
    @DisplayName("空文本 + 非 402 → provider_failed")
    void emptyTextNon402() {
        assertThat(client.classifyError("", 500))
                .isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
    }

    // ---- 优先级验证 ----

    @Test
    @DisplayName("优先级: content > quota（同时命中 content 和 quota 正则 → content_rejected）")
    void priorityContentOverQuota() {
        // 同时包含 copyright 和 余额不足 → content_rejected 优先
        assertThat(client.classifyError("copyright violation 余额不足", 402))
                .isEqualTo(GenerationError.ERROR_CONTENT_REJECTED);
    }

    // ---- isContentPolicySignal / isQuotaSignal 静态方法 ----

    @Test
    @DisplayName("isContentPolicySignal: null → false")
    void contentPolicyNull() {
        assertThat(NewApiAudioClient.isContentPolicySignal(null)).isFalse();
    }

    @Test
    @DisplayName("isQuotaSignal: null → false")
    void quotaNull() {
        assertThat(NewApiAudioClient.isQuotaSignal(null)).isFalse();
    }

    /** 测试用子类：绕过构造函数中的 env 检查。 */
    private static class TestableAudioClient extends NewApiAudioClient {
        TestableAudioClient() {
            super("http://localhost:9999");
        }
    }
}
