package com.bluewhale.worker.infrastructure.storage;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * 内容摘要（IKGS73）。
 * <p>
 * 只做一件事：算出与前端 {@code computeFileMd5} **逐字节对齐**的 md5，供 {@code assets.md5} 落库去重。
 * <p>
 * 两个 TOS 出口（{@link TosMediaStorage} / {@link TosVideoMediaRelay}）都走这里，而不是各写一遍——
 * 本单的全部价值是「同一张图，生成的和上传的能互相命中 md5 去重」，两边算法差一点就等于没填；
 * 而且更糟：字段非空会让人以为去重生效了。放一处，「一致」才是结构性保证而不是纪律要求。
 */
final class ContentDigest {

    private ContentDigest() {}

    /**
     * 原始字节的 MD5，32 位小写 hex。
     * <p>
     * 口径对齐 {@code web/src/utils/upload.ts} 的 {@code computeFileMd5}：同一算法、对**原始字节**
     * 计算、输出小写 hex（那边是 {@code spark.end().toLowerCase()}）。
     */
    static String md5Hex(byte[] data) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("MD5").digest(data));
        } catch (NoSuchAlgorithmException e) {
            // JLS 要求所有 JVM 提供 MD5，正常环境走不到这里；真走到了说明运行环境被改坏，
            // 那种情况下宁可让上传显式失败，也不要静默写入一个空的 md5。
            throw new IllegalStateException("运行环境缺少 MD5 实现", e);
        }
    }
}
