package com.blue.whale.gateway.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.cloud.client.ServiceInstance;
import org.springframework.cloud.client.loadbalancer.reactive.ReactiveLoadBalancer;
import org.springframework.cloud.loadbalancer.support.LoadBalancerClientFactory;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/**
 * 启动时预热 LoadBalancer，触发 Nacos 首次服务发现。
 * 避免第一个用户请求承担 5s+ 的 Nacos 查询延迟。
 */
@Slf4j
@Component
public class LoadBalancerWarmup implements ApplicationRunner {

    private final LoadBalancerClientFactory loadBalancerFactory;

    public LoadBalancerWarmup(LoadBalancerClientFactory loadBalancerFactory) {
        this.loadBalancerFactory = loadBalancerFactory;
    }

    @Override
    public void run(ApplicationArguments args) {
        for (String service : new String[]{"blue-whale-user", "blue-whale-agent"}) {
            ReactiveLoadBalancer<ServiceInstance> lb = loadBalancerFactory.getInstance(service);
            Mono.from(lb.choose()).subscribe(
                    response -> {
                        ServiceInstance si = response.getServer();
                        log.info("LoadBalancer 预热完成: {} → {}", service, si.getUri());
                    },
                    error -> log.warn("LoadBalancer 预热失败: {} ({})", service, error.getMessage())
            );
        }
    }
}