package com.blue.whale.gateway.auth;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 网关统一 JWT 鉴权过滤器。
 * 白名单路径放行，其余 /api/** 校验 token，通过后传 X-User-Id 给下游。
 */
@Slf4j
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 50)
public class JwtAuthGlobalFilter implements GlobalFilter {

    private static final Set<String> WHITELIST = Set.of(
            "/api/auth/send-code",
            "/api/auth/login",
            "/api/auth/captcha",
            "/api/auth/refresh"
    );
    private static final Pattern SEEDANCE_CALLBACK_PATH = Pattern.compile(
            "^/api/webhooks/seedance/[A-Za-z0-9._-]+/[1-9][0-9]*$");

    private final SecretKey secretKey;

    public JwtAuthGlobalFilter(@Value("${jwt.secret:blue-whale-dev-secret-key-at-least-256-bits!!}") String secret) {
        this.secretKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getURI().getPath();

        // 白名单放行
        if (WHITELIST.contains(path) || SEEDANCE_CALLBACK_PATH.matcher(path).matches()) {
            return chain.filter(exchange);
        }

        // 只拦截 /api/**
        if (!path.startsWith("/api/")) {
            return chain.filter(exchange);
        }

        // 取 token
        String header = exchange.getRequest().getHeaders().getFirst("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            return write401(exchange, "未登录或 token 已过期");
        }

        try {
            String token = header.substring(7);
            Claims claims = Jwts.parser()
                    .verifyWith(secretKey)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();

            String userId = claims.getSubject();
            String phone = claims.get("phone", String.class);

            // 通过 → 传 X-User-Id 给下游
            ServerHttpRequest mutated = exchange.getRequest().mutate()
                    .header("X-User-Id", userId)
                    .header("X-Phone", phone != null ? phone : "")
                    .build();
            return chain.filter(exchange.mutate().request(mutated).build());

        } catch (ExpiredJwtException e) {
            return write401(exchange, "token 已过期");
        } catch (JwtException e) {
            return write401(exchange, "token 无效");
        }
    }

    private Mono<Void> write401(ServerWebExchange exchange, String msg) {
        ServerHttpResponse response = exchange.getResponse();
        response.setStatusCode(HttpStatus.UNAUTHORIZED);
        response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
        String body = "{\"code\":401,\"msg\":\"" + msg + "\",\"data\":null}";
        DataBuffer buffer = response.bufferFactory()
                .wrap(body.getBytes(StandardCharsets.UTF_8));
        return response.writeWith(Mono.just(buffer));
    }
}
