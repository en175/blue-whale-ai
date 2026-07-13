package com.blue.whale.tool.idem.helper;


import cn.hutool.core.text.StrPool;
import cn.hutool.core.util.StrUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.RedisTemplate;

import java.lang.reflect.Method;
import java.time.Duration;

/**
 * IdemHelper
 *
 * @author: Jiyeon2__
 * date: 2025/3/31
 * description:
 */
@RequiredArgsConstructor
public class IdemHelper {

    private static final String REDIS_VALUE = "1";
    private static final String KEY_PREFIX = "idem";
    private final RedisTemplate<String, Object> redisTemplate;

    /**
     * @param deviceId 设备id
     * @param methodName 执行方法名
     * @param expire 过期时间
     * @return 是否允许继续执行
     */
    public boolean isAllow(String deviceId, String methodName, long expire) {
        Boolean result = redisTemplate.opsForValue().setIfAbsent(
                StrUtil.join(StrPool.COLON, KEY_PREFIX, deviceId, methodName),
                REDIS_VALUE,
                Duration.ofMillis(expire)
        );
        return result!= null && result;
    }
    /**
     * 获取执行方法名 用于拼接缓存key
     */
    public String getMethodName(Method method) {
        return method.getDeclaringClass() + ":" + method.getName();
    }
}
