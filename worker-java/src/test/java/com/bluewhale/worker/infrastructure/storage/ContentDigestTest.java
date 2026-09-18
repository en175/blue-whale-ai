package com.bluewhale.worker.infrastructure.storage;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * IKGS73：md5 口径的钉子。
 *
 * <p>本单的全部价值是「同一张图，生成的和上传的能互相命中 md5 去重」。前端 {@code computeFileMd5}
 * 输出的是 {@code spark.end().toLowerCase()}——32 位小写 hex。Java 侧只要有一处偏了（大写、
 * 换算法、多算了一层编码），字段照样非空但一次都命中不了，而且**没人会发现**：状态是绿的，
 * 去重是死的。所以这里用 RFC 1321 的公开测试向量把算法与编码钉死。
 *
 * <p>另一个价值是「改坏了会红」：这条断言不依赖任何业务代码，只钉摘要本身。将来谁把出口的
 * md5 换成 sha256 或者加个前缀，这里先炸。
 */
class ContentDigestTest {

    @Test
    @DisplayName("RFC 1321 测试向量：算法就是标准 MD5（不是 sha、不是加盐变体）")
    void matchesRfc1321Vectors() {
        assertThat(ContentDigest.md5Hex(bytes("")))
                .isEqualTo("d41d8cd98f00b204e9800998ecf8427e");
        assertThat(ContentDigest.md5Hex(bytes("a")))
                .isEqualTo("0cc175b9c0f1b6a831c399e269772661");
        assertThat(ContentDigest.md5Hex(bytes("abc")))
                .isEqualTo("900150983cd24fb0d6963f7d28e17f72");
        assertThat(ContentDigest.md5Hex(bytes("message digest")))
                .isEqualTo("f96b697d7cb7938d525a2f31aaf161d0");
    }

    @Test
    @DisplayName("恒为 32 位小写 hex —— 与前端 spark.end().toLowerCase() 逐字符同构")
    void alwaysLowerCaseHexOf32() {
        String hex = ContentDigest.md5Hex(bytes("蓝鲸 blue-whale"));
        // 大小写不是小事：assets 表虽然用 utf8mb4_unicode_ci（比较不区分大小写），但
        // 前端拿到的是小写，两边字符串要能直接 `===` 比对得上，排查时不该多一层换算。
        assertThat(hex).hasSize(32).matches("[0-9a-f]{32}");
    }

    private static byte[] bytes(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }
}
