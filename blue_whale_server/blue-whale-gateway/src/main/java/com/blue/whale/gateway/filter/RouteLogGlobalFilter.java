package com.blue.whale.gateway.filter;

import lombok.extern.slf4j.Slf4j;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.cloud.gateway.route.Route;
import org.springframework.cloud.gateway.support.ServerWebExchangeUtils;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.net.URI;

/**
 * 网关路由日志过滤器。
 * 记录每个请求的方法、路径、转发目标 URI 和最终响应状态、耗时。
 */
@Slf4j
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 200)
public class RouteLogGlobalFilter implements GlobalFilter {

    private static final String START_TIME_ATTR = "routeLogStartTime";

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        exchange.getAttributes().put(START_TIME_ATTR, System.currentTimeMillis());

        return chain.filter(exchange)
                .doFinally(signal -> {
                    long cost = System.currentTimeMillis() - (Long) exchange.getAttribute(START_TIME_ATTR);
                    ServerHttpRequest req = exchange.getRequest();
                    String method = req.getMethodValue();
                    String path = req.getURI().getPath();
                    String query = req.getURI().getRawQuery();

                    Route route = exchange.getAttribute(ServerWebExchangeUtils.GATEWAY_ROUTE_ATTR);
                    URI targetUri = exchange.getAttribute(ServerWebExchangeUtils.GATEWAY_REQUEST_URL_ATTR);

                    int status = exchange.getResponse().getRawStatusCode();

                    String routeId = route != null ? route.getId() : "NO_ROUTE";
                    String target = targetUri != null ? targetUri.getScheme() + "://" + targetUri.getHost() + ":" + targetUri.getPort() : "NO_TARGET";
                    String queryStr = query != null ? "?" + query : "";

                    log.info("{} {} {} → {} [{}] {}ms",
                            method, path + queryStr, routeId, target, status, cost);
                });
    }
}
