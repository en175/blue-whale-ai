package com.blue.whale.gateway.filter;


import com.blue.whale.gateway.util.GatewayHeaderUtils;
import com.blue.whale.gateway.util.IpUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * IpHeaderFilter
 *
 * @author: Jiyeon2__
 * date: 2024/9/27
 * description: 获取客户端ip地址
 */
@Slf4j
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
@RequiredArgsConstructor
public class IpHeaderFilter implements GlobalFilter {


    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {

        String ip = IpUtils.getIpAddr(exchange.getRequest());
        log.debug("客户端ip:{}",ip);
        // 清除客户端伪造头后传递真实 IP 给下游，防 IP 欺骗
        ServerHttpRequest request = exchange.getRequest()
                .mutate()
                .headers(h -> GatewayHeaderUtils.sanitizeAndSet(h, "X-Real-IP", ip))
                .build();
        return chain.filter(exchange.mutate().request(request).build());
    }
}