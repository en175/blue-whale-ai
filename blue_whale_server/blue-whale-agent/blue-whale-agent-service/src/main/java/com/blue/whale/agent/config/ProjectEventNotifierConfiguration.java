package com.blue.whale.agent.config;

import com.blue.whale.agent.service.LocalProjectEventNotifier;
import com.blue.whale.agent.service.ProjectEventNotifier;
import com.blue.whale.agent.service.RedisProjectEventNotifier;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;
import org.redisson.config.SingleServerConfig;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.StringUtils;

@Configuration
public class ProjectEventNotifierConfiguration {

    @Bean(destroyMethod = "shutdown")
    @ConditionalOnProperty(prefix = "blue-whale.project-events", name = "redis-enabled",
            havingValue = "true", matchIfMissing = true)
    public RedissonClient projectEventRedissonClient(
            @Value("${spring.redis.host}") String host,
            @Value("${spring.redis.port:6379}") int port,
            @Value("${spring.redis.password:}") String password,
            @Value("${spring.redis.database:0}") int database) {
        Config config = new Config();
        SingleServerConfig server = config.useSingleServer()
                .setAddress("redis://" + host + ":" + port)
                .setDatabase(database);
        if (StringUtils.hasText(password)) {
            server.setPassword(password);
        }
        return Redisson.create(config);
    }

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.project-events", name = "redis-enabled",
            havingValue = "true", matchIfMissing = true)
    public ProjectEventNotifier redisProjectEventNotifier(
            RedissonClient projectEventRedissonClient,
            ObjectMapper objectMapper,
            @Value("${blue-whale.project-events.channel:blue-whale:project-events}") String channel) {
        return new RedisProjectEventNotifier(projectEventRedissonClient, objectMapper, channel);
    }

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.project-events", name = "redis-enabled",
            havingValue = "false")
    public ProjectEventNotifier localProjectEventNotifier() {
        return new LocalProjectEventNotifier();
    }
}
