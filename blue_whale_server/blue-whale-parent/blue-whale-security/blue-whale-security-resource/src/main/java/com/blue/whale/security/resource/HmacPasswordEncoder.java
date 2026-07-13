package com.blue.whale.security.resource;


import cn.hutool.core.util.RandomUtil;
import cn.hutool.crypto.digest.HMac;
import org.springframework.security.crypto.codec.Utf8;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.security.MessageDigest;

/**
 * HmacPasswordEncoder
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: HMAC摘要算法 密码转码器
 */
public class HmacPasswordEncoder implements PasswordEncoder {


    /**
     * 盐的最小长度
     */
    private static final int MIN_SALT_LENGTH = 5;

    /**
     * 默认 盐的长度
     */
    private static final int DEFAULT_SALT_LENGTH = 16;

    /**
     * 盐的长度
     */
    private final int saltLength;

    /**
     * HMAC摘要算法 （Hash Message Authentication Code”，中文名“散列消息鉴别码）
     */
    private final HMac hmac;


    public HmacPasswordEncoder(HMac hmac) {
        this(DEFAULT_SALT_LENGTH, hmac);
    }

    public HmacPasswordEncoder(int saltLength, HMac hmac) {
        if (saltLength < MIN_SALT_LENGTH) {
            throw new IllegalArgumentException("illegal argument saltLength (Must be greater than 5)" + saltLength);
        }
        if (hmac == null) {
            throw new IllegalArgumentException("hmac cannot be null!");
        }
        this.saltLength = saltLength;
        this.hmac = hmac;
    }

    /**
     * 对原始密码进行转码
     *
     * @param rawPassword 原始密码
     * @return 转码结果
     */
    @Override
    public String encode(CharSequence rawPassword) {
        return this.encodeWithSalt(rawPassword.toString(), this.genSalt());
    }

    /**
     * 对原始密码进行加盐转码
     *
     * @param rawPassword 原始密码
     * @param salt        盐
     * @return 转码结果
     */
    public String encodeWithSalt(String rawPassword, String salt) {
        return '$' + salt + hmac.digestHex(rawPassword + salt);
    }

    /**
     * 原始密码与转码后的密码是否匹配
     *
     * @param rawPassword     原始密码
     * @param encodedPassword 转码后的密码
     * @return 原始密码与转码后的密码是否匹配
     */
    @Override
    public boolean matches(CharSequence rawPassword, String encodedPassword) {
        if (rawPassword == null || encodedPassword == null) {
            return false;
        }

        String encodeWithSalt = this.encodeWithSalt(rawPassword.toString(), this.getRealSalt(encodedPassword));
        return MessageDigest.isEqual(
                Utf8.encode(encodeWithSalt),
                Utf8.encode(encodedPassword)
        );
    }

    /**
     * 随机生成盐
     *
     * @return 盐
     */
    private String genSalt() {
        return RandomUtil.randomString(saltLength);
    }

    /**
     * 从转码后的密码中取出真实盐
     *
     * @param encodedPassword 转码后的密码
     * @return 真实盐
     */
    private String getRealSalt(String encodedPassword) {
        return encodedPassword.substring(1, saltLength + 1);
    }
}
