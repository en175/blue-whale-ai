package com.bluewhale.worker.config;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HexFormat;

/**
 * `system_settings` 密文信封的**解封**（AES-256-GCM）——TS 侧
 * `backend/libs/shared/system-settings/credentials-crypto.ts` 的 Java 对端。
 *
 * <p>两处实现同一个信封格式，是「配置在库里、两端都要读」的必然代价。为把漂移风险钉住：
 * 信封格式逐字对齐（{@code v1.<iv>.<tag>.<ciphertext>}，各段 base64url，GCM tag 128 位、
 * IV 12 字节），并由 {@code SystemSettingEnvelopeTest} 用**Node 侧生成的真实信封**做
 * 跨语言测试向量——格式改了一端而没改另一端，那条用例会红。
 *
 * <p>⚠️ **本类只解不封**：worker 永远不写设置行（写入者是管理端）。没有 {@code seal} 就没有
 * 「worker 悄悄改写配置」这条路径。
 *
 * <p>⚠️ **失败一律抛，不降级**：格式不对、密钥不对、认证标签对不上（密文被改过）都抛——
 * 静默当成明文或空串用，会把「凭证已泄露 / 配置被绕过」这件事盖住。
 */
public final class SystemSettingEnvelope {

    /** 主密钥的环境变量名（与 TS 侧 {@code SYSTEM_SETTINGS_SECRET_ENV} 同值）。 */
    public static final String SECRET_ENV = "SYSTEM_SETTINGS_SECRET";

    private static final String VERSION = "v1";
    private static final int KEY_BYTES = 32;   // AES-256
    private static final int TAG_BITS = 128;   // GCM 推荐长度，与 TS 侧 Node 默认一致
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    private SystemSettingEnvelope() {
    }

    /**
     * 解开一个 {@code v1} 信封，返回明文（通常是模块 JSON 原文）。
     *
     * @param envelope {@code v1.<iv>.<tag>.<ciphertext>}
     * @param secret   {@code SYSTEM_SETTINGS_SECRET}：64 位十六进制，或 base64 解出 32 字节
     * @throws IllegalStateException 密钥不可用、信封格式不对、或解密失败（密钥不一致 / 密文被改）
     */
    public static String open(String envelope, String secret) {
        if (envelope == null || envelope.isBlank()) {
            throw new IllegalStateException("凭证密文为空，无法解密");
        }
        String[] parts = envelope.split("\\.", -1);
        if (parts.length != 4 || !VERSION.equals(parts[0])
                || parts[1].isEmpty() || parts[2].isEmpty() || parts[3].isEmpty()) {
            // 与 TS 侧同口径：连「看起来像明文的历史值」也拒——那说明有人绕过服务写过库，
            // 静默当成明文用会把那件事盖住。
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
        // JCE 的 GCM 约定：doFinal 收的是 ciphertext || tag（与 Node 的 setAuthTag 分开传不同）。
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
            // 只有两种可能：密钥换了，或密文被改过。原样抛会把 GCM 的内部文案漏出去，
            // 也不会更有信息量——运维要查的是「SYSTEM_SETTINGS_SECRET 有没有变」。
            throw new IllegalStateException(
                    "凭证解密失败：密钥与入库时不一致（或密文被改动过）——请核对 " + SECRET_ENV, e);
        }
    }

    /**
     * 解析主密钥。
     *
     * <p>接受两种写法（与 TS 侧 {@code masterKey} 逐字对齐）：64 位十六进制，或 base64
     * 解出 32 字节。**要求恰好 32 字节**而不是「任意口令 KDF 一下」：KDF 会让「口令有多弱」
     * 从部署配置里消失，而这里没有校验弱口令的地方。宁可在配置阶段报错。
     */
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
