package com.blue.whale.user.config;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.UUID;

@Slf4j
@Component
public class JwtUtil {

    private final JwtConfig jwtConfig;
    private final SecretKey secretKey;

    /** access_token 有效期（秒），默认 15 分钟 */
//    private static final long ACCESS_EXPIRATION = 900;
    private static final long ACCESS_EXPIRATION = 60*60*24;
    /** refresh_token 有效期（秒），默认 30 天 */
    private static final long REFRESH_EXPIRATION = 2_592_000;

    public JwtUtil(JwtConfig jwtConfig) {
        this.jwtConfig = jwtConfig;
        this.secretKey = Keys.hmacShaKeyFor(jwtConfig.getSecret().getBytes(StandardCharsets.UTF_8));
    }

    /** 生成 access_token（短，15分钟） */
    public String generateAccessToken(String userId, String phone) {
        Date now = new Date();
        return Jwts.builder()
                .subject(userId)
                .claim("phone", phone)
                .claim("type", "access")
                .issuedAt(now)
                .expiration(new Date(now.getTime() + ACCESS_EXPIRATION * 1000L))
                .signWith(secretKey)
                .compact();
    }

    /** 生成 refresh_token（长，30天），含 jti 用于 Redis 追踪 */
    public String generateRefreshToken(String userId) {
        Date now = new Date();
        return Jwts.builder()
                .subject(userId)
                .id(UUID.randomUUID().toString())
                .claim("type", "refresh")
                .issuedAt(now)
                .expiration(new Date(now.getTime() + REFRESH_EXPIRATION * 1000L))
                .signWith(secretKey)
                .compact();
    }

    public long getAccessExpiration() { return ACCESS_EXPIRATION; }

    /** 解析 token */
    public Claims parse(String token) {
        return Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }
}
