package com.blue.whale.gateway.auth;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.Test;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class JwtAuthGlobalFilterTest {

    private static final String SECRET = "test-secret-key-for-unit-tests-at-least-256-bits!!";

    @Test
    void overwritesClientSuppliedIdentityWithVerifiedJwtSubject() {
        JwtAuthGlobalFilter filter = new JwtAuthGlobalFilter(SECRET);
        String token = Jwts.builder()
                .subject("42")
                .claim("phone", "13800000000")
                .expiration(new Date(System.currentTimeMillis() + 60_000))
                .signWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8)))
                .compact();
        MockServerWebExchange exchange = MockServerWebExchange.from(
                MockServerHttpRequest.get("/api/projects/7/snapshot")
                        .header("Authorization", "Bearer " + token)
                        .header("X-User-Id", "999"));
        AtomicReference<ServerWebExchange> forwarded = new AtomicReference<>();
        GatewayFilterChain chain = next -> {
            forwarded.set(next);
            return Mono.empty();
        };

        filter.filter(exchange, chain).block();

        assertThat(forwarded.get()).isNotNull();
        assertThat(forwarded.get().getRequest().getHeaders().get("X-User-Id"))
                .containsExactly("42");
        assertThat(forwarded.get().getRequest().getHeaders().getFirst("X-Phone"))
                .isEqualTo("13800000000");
    }

    @Test
    void rejectsProtectedApiWithoutBearerToken() {
        JwtAuthGlobalFilter filter = new JwtAuthGlobalFilter(SECRET);
        MockServerWebExchange exchange = MockServerWebExchange.from(
                MockServerHttpRequest.get("/api/projects/7/snapshot"));
        AtomicReference<ServerWebExchange> forwarded = new AtomicReference<>();

        filter.filter(exchange, next -> {
            forwarded.set(next);
            return Mono.empty();
        }).block();

        assertThat(forwarded.get()).isNull();
        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void allowsOnlySeedanceCallbackShapeWithoutBearerToken() {
        JwtAuthGlobalFilter filter = new JwtAuthGlobalFilter(SECRET);
        MockServerWebExchange callback = MockServerWebExchange.from(
                MockServerHttpRequest.post("/api/webhooks/seedance/account-1/27?capability=opaque"));
        AtomicReference<ServerWebExchange> forwarded = new AtomicReference<>();

        filter.filter(callback, next -> {
            forwarded.set(next);
            return Mono.empty();
        }).block();

        assertThat(forwarded.get()).isNotNull();

        MockServerWebExchange unrelatedWebhook = MockServerWebExchange.from(
                MockServerHttpRequest.post("/api/webhooks/other/account-1/27"));
        filter.filter(unrelatedWebhook, next -> Mono.empty()).block();
        assertThat(unrelatedWebhook.getResponse().getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }
}
