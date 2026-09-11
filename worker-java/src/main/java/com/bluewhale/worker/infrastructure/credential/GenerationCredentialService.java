package com.bluewhale.worker.infrastructure.credential;

import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;

/**
 * 生成凭证密封/解封（packages/core/src/generation-credential.ts 逐字移植）。
 * <p>
 * 算法：AES-256-GCM；密文格式：{@code v1.<nonce-b64url>.<tag-b64url>.<ciphertext-b64url>}。
 * <p>
 * 密钥派生：{@code SHA-256(secret)}——secret 是 ≥16 字符的 UTF-8 原文（generation-credential.ts:72-75）。
 * <p>
 * Java 移植注意事项：
 * <ul>
 *   <li>Node.js base64url = RFC 4648 §5（URL-safe，无 padding）——Java 用 {@code Base64.getUrlDecoder()}</li>
 *   <li>Node.js GCM authTag 默认 16 字节——Java GCMParameterSpec 128 bit</li>
 *   <li>Java Cipher "AES/GCM/NoPadding" 自动附加 authTag 到密文末尾（与 Node 的 update+final 拼接一致）</li>
 * </ul>
 */
@Component
@org.springframework.context.annotation.Conditional(com.bluewhale.worker.config.GenerationTagsCondition.class)
public class GenerationCredentialService {

    /** 版本前缀（generation-credential.ts:8）。 */
    private static final String VERSION = "v1";

    /** GCM auth tag 长度（bits）。 */
    private static final int GCM_TAG_BITS = 128;

    /** GCM nonce 长度（bytes）。 */
    private static final int GCM_NONCE_BYTES = 12;

    private final String secret;

    /**
     * 从环境变量 GENERATION_CREDENTIAL_SECRET 构建（generation-credential.ts:22-30）。
     * 长度 < 16 → 启动失败（与 TS 一致）。
     */
    public GenerationCredentialService() {
        this(System.getenv("GENERATION_CREDENTIAL_SECRET"));
    }

    /** 测试用构造器：注入 secret。 */
    GenerationCredentialService(String secret) {
        if (secret == null || secret.length() < 16) {
            throw new IllegalStateException(
                    "GENERATION_CREDENTIAL_SECRET must be configured with at least 16 characters");
        }
        this.secret = secret;
    }

    /**
     * 解封凭证（openGenerationCredential，generation-credential.ts:52-70）。
     *
     * @param ciphertext 格式 v1.nonce.tag.encrypted（各段 base64url）
     * @return 解密后的明文 token
     * @throws IllegalArgumentException 密文格式无效或解密失败
     */
    public String open(String ciphertext) {
        String[] parts = ciphertext.split("\\.");
        if (parts.length != 4 || !VERSION.equals(parts[0])
                || parts[1].isEmpty() || parts[2].isEmpty() || parts[3].isEmpty()) {
            throw new IllegalArgumentException("生成凭证密文无效");
        }

        byte[] nonce = Base64.getUrlDecoder().decode(parts[1]);
        byte[] tag = Base64.getUrlDecoder().decode(parts[2]);
        byte[] encrypted = Base64.getUrlDecoder().decode(parts[3]);

        if (nonce.length != GCM_NONCE_BYTES) {
            throw new IllegalArgumentException("生成凭证密文无效");
        }

        try {
            byte[] key = credentialKey(secret);
            SecretKeySpec keySpec = new SecretKeySpec(key, "AES");
            GCMParameterSpec gcmSpec = new GCMParameterSpec(GCM_TAG_BITS, nonce);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, keySpec, gcmSpec);

            // Java Cipher：解密时需将 ciphertext + authTag 拼接传入（Java GCM 自动分离 tag）
            byte[] combined = new byte[encrypted.length + tag.length];
            System.arraycopy(encrypted, 0, combined, 0, encrypted.length);
            System.arraycopy(tag, 0, combined, encrypted.length, tag.length);

            byte[] plaintext = cipher.doFinal(combined);
            return new String(plaintext, StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalArgumentException("生成凭证解密失败", e);
        }
    }

    /**
     * 密钥派生（credentialKey，generation-credential.ts:72-75）。
     * SHA-256(secret) → 32 bytes（AES-256 密钥长度）。
     */
    static byte[] credentialKey(String secret) {
        try {
            MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
            return sha256.digest(secret.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new RuntimeException("SHA-256 不可用", e);
        }
    }
}
