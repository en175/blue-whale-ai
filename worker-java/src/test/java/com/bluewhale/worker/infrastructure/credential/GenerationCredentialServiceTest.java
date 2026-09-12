package com.bluewhale.worker.infrastructure.credential;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 凭证读取测试（修正四：凭证去密，原 AES-256-GCM 解封测试已废弃）。
 * <p>
 * 2026-09-12 用户拍板：job.input.provider_credential 改明文，open() 退化为明文直通。
 * 原「与 TS sealGenerationCredential 逐字兼容」的向量测试不再适用。
 */
class GenerationCredentialServiceTest {

    private final GenerationCredentialService svc = new GenerationCredentialService();

    @Test
    @DisplayName("明文 sk token 原样返回（不再解密）")
    void plaintextPassthrough() {
        assertThat(svc.open("sk-test-token-abc123")).isEqualTo("sk-test-token-abc123");
    }

    @Test
    @DisplayName("含 UTF-8 特殊字符的 token 原样返回")
    void utf8Token() {
        assertThat(svc.open("sk-test-特殊字符-🎵")).isEqualTo("sk-test-特殊字符-🎵");
    }

    @Test
    @DisplayName("空凭证 → 抛异常（调用方归 provider_credential_missing）")
    void emptyCredential() {
        assertThatThrownBy(() -> svc.open(""))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> svc.open(null))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
