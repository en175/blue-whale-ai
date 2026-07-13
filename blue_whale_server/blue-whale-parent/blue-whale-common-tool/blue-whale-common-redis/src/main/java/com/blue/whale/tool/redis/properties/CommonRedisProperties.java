package com.blue.whale.tool.redis.properties;


import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * CommonRedisProperties
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: redis配置
 */
@Getter
@Setter
@ConfigurationProperties(prefix = "sweet.oa.redis")
public class CommonRedisProperties {
    /**
     * RedisMessageListenerContainer
     */
    private Boolean enableMessageListener = Boolean.FALSE;

    /**
     * 过期时间配置
     */
    private List<Expire> expires = new ArrayList<>();

    @Getter
    @Setter
    public static class Expire {
        /**
         * 缓存key
         */
        private String key;
        /**
         * 缓存时长
         */
        private long ttl;
        /**
         * 缓存单位
         */
        private TimeUnit unit = TimeUnit.SECONDS;
    }
}
