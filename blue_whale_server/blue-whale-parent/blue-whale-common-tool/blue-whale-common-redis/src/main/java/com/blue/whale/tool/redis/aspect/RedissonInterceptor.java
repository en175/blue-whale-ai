package com.blue.whale.tool.redis.aspect;


import cn.hutool.core.util.ArrayUtil;
import cn.hutool.core.util.StrUtil;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.constants.CommonPool;
import com.blue.whale.tool.redis.annotation.Redisson;
import com.blue.whale.tool.redis.constants.RedisConstant;
import com.blue.whale.tool.redis.utils.RedisUtil;
import com.blue.whale.tool.redis.utils.SpringElUtil;
import io.vavr.control.Option;
import lombok.extern.slf4j.Slf4j;
import org.aopalliance.intercept.MethodInterceptor;
import org.aopalliance.intercept.MethodInvocation;
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.core.annotation.AnnotationUtils;

import java.lang.reflect.Method;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * RedissonInterceptor
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: redis锁拦截器
 */
@Slf4j
public class RedissonInterceptor implements MethodInterceptor {


    private final RedissonClient redissonClient;

    public RedissonInterceptor(RedissonClient redissonClient) {
        this.redissonClient = redissonClient;
    }

    @Override
    public Object invoke(MethodInvocation invocation) throws Throwable {
        //获取注解
        Redisson annotation = AnnotationUtils.findAnnotation(invocation.getMethod(), Redisson.class);
        if (annotation == null) {
            return invocation.proceed();
        }
        log.debug("@Redisson annotation aspect working...");
        //渲染锁生成锁
        RLock lock = this.getLock(annotation, invocation);
        //尝试获取锁
        boolean success = lock.tryLock(annotation.waitTime(), annotation.leaseTime(), annotation.unit());
        //获取失败 抛出系统繁忙的异常
        if (!success) {
            log.debug("....redisson lock fail....");
            throw SystemCode.SYSTEM_BUSY.exception();
        }
        try {
            return invocation.proceed();
        } finally {
            lock.unlock();
            log.debug("....redisson lock release....");
        }
    }

    /**
     * 获取分布式锁
     * 1。 单个锁
     * 2。 批量锁
     *
     * @param annotation 分布式锁 注解
     * @param invocation 代理方法执行器
     * @return 分布式锁
     */
    private RLock getLock(Redisson annotation, MethodInvocation invocation) {
        String param = annotation.batchParamName();
        //是否是批量锁
        if (StrUtil.isBlank(param)) {
            //单锁
            String key = this.singleKey(annotation.value(), annotation.key(), invocation);
            log.debug("Redisson...lock key:{}", key);
            return redissonClient.getLock(key);
        }
        //批量锁
        Method method = invocation.getMethod();
        String[] paramNames = SpringElUtil.parameterNames(method);
        if (ArrayUtil.isEmpty(paramNames)) {
            throw new IllegalStateException("parameters name missed");
        }
        //渲染所有锁的key
        Set<String> multiLockKeys = getMultiLockKeys(annotation, invocation, param.trim(), paramNames);
        log.debug("Redisson...batch lock key:{}", multiLockKeys);
        return redissonClient.getMultiLock(
                multiLockKeys
                        .stream()
                        .map(redissonClient::getLock)
                        .toArray(RLock[]::new)
        );
    }

    /**
     * 获取批量锁 key 集合
     *
     * @param annotation 注解
     * @param invocation 代理方法执行期
     * @param paramName  批量锁 方法参数名
     * @param paramNames 代理方法参数名数组
     * @return 批量锁 key 集合
     */
    private Set<String> getMultiLockKeys(Redisson annotation, MethodInvocation invocation, String paramName, String[] paramNames) {
        String name = annotation.value();
        String key = annotation.key();
        Collection<?> collection = SpringElUtil.render(paramName, invocation.getMethod(), invocation.getArguments(), null,
                Collection.class);
        return collection.stream().map(item -> this.batchItemKey(name, key, invocation, item)).collect(Collectors.toSet());
    }


    /**
     * 获取 批量锁参数名对应的 参数值
     *
     * @param paramName  批量锁参数名
     * @param paramNames 方法参数名称数组
     * @param args       方法参数数组
     * @return 批量锁参数名对应的 参数值
     */
    private Option<Object> getTargetArg(String paramName, String[] paramNames, Object[] args) {
        for (int i = 0; i < paramNames.length; i++) {
            if (paramName.equals(paramNames[i])) {
                return Option.of(args[i]);
            }
        }
        return Option.none();
    }

    /**
     * 获取批量锁 单个锁的key值
     *
     * @param name       配置的注解锁名称
     * @param key        配置的key值 支持spEL
     * @param invocation 代理方法执行器
     * @param item       单个对象值
     * @return 锁的全路径key
     */
    private String batchItemKey(String name, String key, MethodInvocation invocation, Object item) {
        return this.key(name, key, invocation, new HashMap<>(CommonPool.NUMBER_TWO) {
            {
                put(RedisConstant.BATCH_LOCK_ITEM, item);
            }
        });
    }


    /**
     * 单个锁的key值
     *
     * @param name       配置的注解锁名称
     * @param key        配置的key值 支持spEL
     * @param invocation 代理方法执行器
     * @return 锁的全路径key
     */
    private String singleKey(String name, String key, MethodInvocation invocation) {
        return this.key(name, key, invocation, null);
    }

    /**
     * 单个锁的key值
     *
     * @param name       配置的注解锁名称
     * @param key        配置的key值 支持spEL
     * @param invocation 代理方法执行器
     * @param otherParam 其它参数列表
     * @return 锁的全路径key
     */
    private String key(String name, String key, MethodInvocation invocation, Map<String, Object> otherParam) {
        return StrUtil.isEmpty(key) ? RedisUtil.getLockKey(name) :
                RedisUtil.getLockKey(
                        name,
                        SpringElUtil.render(
                                key, invocation.getMethod(), invocation.getArguments(), otherParam, String.class
                        )
                );

    }
}
