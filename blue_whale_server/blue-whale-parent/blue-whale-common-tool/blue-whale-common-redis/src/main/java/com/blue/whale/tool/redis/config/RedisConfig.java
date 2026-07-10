package com.blue.whale.tool.redis.config;


import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.text.StrPool;
import cn.hutool.core.util.StrUtil;
import com.blue.whale.tool.redis.properties.CommonRedisProperties;
import com.blue.whale.tool.redis.utils.RedisUtil;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cache.CacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.connection.RedisConnectionFactory;

import java.time.Duration;
import java.util.stream.Collectors;

/**
 * RedisConfig
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: redis配置
 */
public class RedisConfig {
    private final CommonRedisProperties redisProperties;
    private final String serviceName;

    public RedisConfig(CommonRedisProperties redisProperties, @Value("${spring.application.name}") String serviceName) {
        this.redisProperties = redisProperties;
        this.serviceName = serviceName;
    }

    @Bean
    @Primary
    public CacheManager cacheManager(RedisConnectionFactory redisConnectionFactory) {

        RedisCacheConfiguration config = RedisCacheConfiguration.defaultCacheConfig()
                .computePrefixWith(
                        (cacheName) -> RedisUtil.key(
                                StrUtil.replace(serviceName, StrPool.DASHED, StrPool.COLON),
                                cacheName
                        ) + StrPool.COLON
                );
        return RedisCacheManager.builder(redisConnectionFactory)
                .cacheDefaults(config)
                .withInitialCacheConfigurations(
                        CollUtil.emptyIfNull(redisProperties.getExpires())
                                .stream()
                                .collect(
                                        Collectors.toMap(
                                                CommonRedisProperties.Expire::getKey,
                                                expire -> config.entryTtl(
                                                        Duration.ofMillis(
                                                                expire.getUnit().toMillis(expire.getTtl())
                                                        )
                                                )
                                        )
                                )
                ).build();
    }
}
