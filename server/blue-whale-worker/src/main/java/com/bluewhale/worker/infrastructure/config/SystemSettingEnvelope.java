package com.bluewhale.worker.infrastructure.config;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HexFormat;

public final class SystemSettingEnvelope {

    public static final String SECRET_ENV = "SYSTEM_SETTINGS_SECRET";

    private static final String VERSION = "v1";
    private static final int KEY_BYTES = 32;
    private static final int TAG_BITS = 128;
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    private SystemSettingEnvelope() {
    }

    public static String open(String envelope, String secret) {
        if (envelope == null || envelope.isBlank()) {
            throw new IllegalStateException("凭证密文为空，无法解密");
        }
        String[] parts = envelope.split("\\.", -1);
        if (parts.length != 4 || !VERSION.equals(parts[0])
                || parts[1].isEmpty() || parts[2].isEmpty() || parts[3].isEmpty()) {
            throw new IllegalStateException(
                    "凭证密文信封格式不对（应为 " + VERSION + ".<iv>.<tag>.<ciphertext>），不接受明文或旧格式");
        }
        Base64.Decoder b64 = Base64.getUrlDecoder();
        byte[] iv;
        byte[] tag;
        byte[] data;
        try {
            iv = b64.decode(parts[1]);
            tag = b64.decode(parts[2]);
            data = b64.decode(parts[3]);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException("凭证密文信封各段必须是 base64url：" + e.getMessage(), e);
        }
        byte[] ciphertextWithTag = new byte[data.length + tag.length];
        System.arraycopy(data, 0, ciphertextWithTag, 0, data.length);
        System.arraycopy(tag, 0, ciphertextWithTag, data.length, tag.length);
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(masterKey(secret), "AES"),
                    new GCMParameterSpec(TAG_BITS, iv));
            return new String(cipher.doFinal(ciphertextWithTag), StandardCharsets.UTF_8);
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException(
                    "凭证解密失败：密钥与入库时不一致（或密文被改动过）——请核对 " + SECRET_ENV, e);
        }
    }

    static byte[] masterKey(String secret) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException(
                    SECRET_ENV + " 未配置：它必须与数据库分开存放；未配置时解不出凭证");
        }
        String raw = secret.trim();
        byte[] key;
        try {
            key = raw.matches("[0-9a-fA-F]{64}")
                    ? HexFormat.of().parseHex(raw)
                    : Base64.getDecoder().decode(raw);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException(
                    SECRET_ENV + " 既不是 64 位十六进制、也不是合法 base64：" + e.getMessage(), e);
        }
        if (key.length != KEY_BYTES) {
            throw new IllegalStateException(
                    SECRET_ENV + " 须为 32 字节（64 位十六进制或 base64），实际解出 " + key.length + " 字节");
        }
        return key;
    }
}
