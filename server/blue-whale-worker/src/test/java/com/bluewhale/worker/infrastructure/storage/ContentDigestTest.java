package com.bluewhale.worker.infrastructure.storage;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

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
        assertThat(hex).hasSize(32).matches("[0-9a-f]{32}");
    }

    private static byte[] bytes(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }
}
