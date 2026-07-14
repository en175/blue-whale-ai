package com.blue.whale.gateway.auth;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import lombok.Setter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.cloud.context.config.annotation.RefreshScope;
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
import java.util.Collections;
import java.util.List;
import java.util.Set;

/**
 * 网关统一 JWT 鉴权过滤器。
 * 白名单路径放行（前缀匹配），其余 /api/** 校验 token，通过后传 X-User-Id 给下游。
 */
@Slf4j
@Component
@RefreshScope
@Order(Ordered.HIGHEST_PRECEDENCE + 50)
@ConfigurationProperties(prefix = "gateway.auth")
public class JwtAuthGlobalFilter implements GlobalFilter {

    /** 白名单路径列表（前缀匹配），由 {@code gateway.auth.whitelist} 配置注入 */
    @Setter
    private List<String> whitelist;

    private final SecretKey secretKey;

    public JwtAuthGlobalFilter(
            @Value("${jwt.secret:blue-whale-dev-secret-key-at-least-256-bits!!}") String secret) {
        this.secretKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    private Set<String> whitelistSet() {
        if (whitelist == null || whitelist.isEmpty()) {
            return Collections.emptySet();
        }
        return Set.copyOf(whitelist);
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getURI().getPath();

        // 白名单放行（前缀匹配：/api/agent/templates 放行 /api/agent/templates/page 等子路径）
        if (whitelistSet().stream().anyMatch(path::startsWith)) {
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
