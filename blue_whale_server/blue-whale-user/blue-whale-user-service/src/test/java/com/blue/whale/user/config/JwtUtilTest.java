package com.blue.whale.user.config;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwtUtilTest {

    private JwtUtil jwtUtil;

    @BeforeEach
    void setUp() {
        JwtConfig config = new JwtConfig();
        config.setSecret("test-secret-key-for-unit-tests-at-least-256-bits!!");
        config.setExpiration(604800L);
        jwtUtil = new JwtUtil(config);
    }

    @Test
    void generateAndParse() {
        String token = jwtUtil.generate("1", "13800138000");
        Claims claims = jwtUtil.parse(token);

        assertThat(claims.getSubject()).isEqualTo("1");
        assertThat(claims.get("phone", String.class)).isEqualTo("13800138000");
    }

    @Test
    void expiredToken() {
        // 生成后立刻用过期 secret 的 config 解析
        JwtConfig expiredConfig = new JwtConfig();
        expiredConfig.setSecret("test-secret-key-for-unit-tests-at-least-256-bits!!");
        expiredConfig.setExpiration(-1L);  // 立即过期

        JwtUtil expiredJwtUtil = new JwtUtil(expiredConfig);
        String token = expiredJwtUtil.generate("1", "13800138000");

        assertThatThrownBy(() -> jwtUtil.parse(token))
                .isInstanceOf(ExpiredJwtException.class);
    }

    @Test
    void invalidToken() {
        assertThatThrownBy(() -> jwtUtil.parse("invalid.token.here"))
                .isInstanceOf(JwtException.class);
    }

    @Test
    void wrongSecret() {
        JwtConfig wrongConfig = new JwtConfig();
        wrongConfig.setSecret("wrong-secret-key-for-unit-tests-at-least-256-bit!!");
        wrongConfig.setExpiration(604800L);

        JwtUtil wrongJwtUtil = new JwtUtil(wrongConfig);
        String token = wrongJwtUtil.generate("1", "13800138000");

        assertThatThrownBy(() -> jwtUtil.parse(token))
                .isInstanceOf(JwtException.class);
    }
}
