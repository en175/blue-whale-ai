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
        jwtUtil = new JwtUtil(config);
    }

    @Test
    void generateAndParse() {
        String token = jwtUtil.generateAccessToken("1", "13800138000");
        Claims claims = jwtUtil.parse(token);

        assertThat(claims.getSubject()).isEqualTo("1");
        assertThat(claims.get("phone", String.class)).isEqualTo("13800138000");
    }

    @Test
    void generateRefreshToken() {
        String token = jwtUtil.generateRefreshToken("1");
        Claims claims = jwtUtil.parse(token);

        assertThat(claims.getSubject()).isEqualTo("1");
        assertThat(claims.get("type", String.class)).isEqualTo("refresh");
        assertThat(claims.getId()).isNotBlank();
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
        JwtUtil wrongJwtUtil = new JwtUtil(wrongConfig);
        String token = wrongJwtUtil.generateAccessToken("1", "13800138000");

        assertThatThrownBy(() -> jwtUtil.parse(token))
                .isInstanceOf(JwtException.class);
    }
}
