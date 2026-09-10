package com.bluewhale.worker.infrastructure.credential;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * AES-256-GCM 凭证解封测试（packages/core/src/generation-credential.ts 逐字移植）。
 * <p>
 * 测试向量由 TS sealGenerationCredential 生成（固定 nonce=12零字节），
 * 确保 Java 与 TS 的 base64url 编码、GCM authTag 拼接、SHA-256 key 派生完全兼容。
 * <p>
 * 密文格式：v1.&lt;nonce-b64url&gt;.&lt;tag-b64url&gt;.&lt;ciphertext-b64url&gt;
 */
class GenerationCredentialServiceTest {

    /** 测试用 secret（≥16 字符）。 */
    private static final String SECRET = "test-secret-at-least-16-chars!!";

    /**
     * 测试向量由 TS sealGenerationCredential 生成（固定 nonce = 12 零字节）。
     * seal('sk-test-token-abc123', secret) → FIX1
     */
    private static final String FIX1 = "v1.AAAAAAAAAAAAAAAA.aHqZ5M5mpEsg-Brc09lgsQ.OtcWqckPzpGP-0VjlYERdrmrrd8";

    /** seal('sk-abcdefghijklmnopqrstuvwxyz0123456789', secret) → FIX2 */
    private static final String FIX2 = "v1.AAAAAAAAAAAAAAAA.QurwBLOheDNe5yzvLqNpSA.OtcWvM4f3tmd80ZvkcccebT1753dfd5DxuW1rhkg9aD24LiKa8c8";

    /** seal('sk-test-特殊字符-🎵', secret) → FIX3 */
    private static final String FIX3 = "v1.AAAAAAAAAAAAAAAA.u8uQNzadWw0uVYbMy-UL7w.OtcWqckPzpEcHZfgVSaVuU19M0qC_jW4BQ";

    @Test
    @DisplayName("向量1: 简单 ASCII token")
    void fixture1_simpleToken() {
        GenerationCredentialService svc = new GenerationCredentialService(SECRET);
        assertThat(svc.open(FIX1)).isEqualTo("sk-test-token-abc123");
    }

    @Test
    @DisplayName("向量2: 长 ASCII token")
    void fixture2_longToken() {
        GenerationCredentialService svc = new GenerationCredentialService(SECRET);
        assertThat(svc.open(FIX2)).isEqualTo("sk-abcdefghijklmnopqrstuvwxyz0123456789");
    }

    @Test
    @DisplayName("向量3: 含 UTF-8 特殊字符（中文 + emoji）")
    void fixture3_utf8Token() {
        GenerationCredentialService svc = new GenerationCredentialService(SECRET);
        assertThat(svc.open(FIX3)).isEqualTo("sk-test-特殊字符-🎵");
    }

    @Test
    @DisplayName("错误 secret → 解密失败")
    void wrongSecret() {
        GenerationCredentialService svc = new GenerationCredentialService("wrong-secret-but-long-enough!!");
        assertThatThrownBy(() -> svc.open(FIX1))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("无效格式 → 抛异常")
    void invalidFormat() {
        GenerationCredentialService svc = new GenerationCredentialService(SECRET);
        assertThatThrownBy(() -> svc.open("not-valid-ciphertext"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> svc.open("v2.AAAA.BBBB.CCCC"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("secret 长度 < 16 → 构造失败")
    void shortSecret() {
        assertThatThrownBy(() -> new GenerationCredentialService("short"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("at least 16");
    }
}
