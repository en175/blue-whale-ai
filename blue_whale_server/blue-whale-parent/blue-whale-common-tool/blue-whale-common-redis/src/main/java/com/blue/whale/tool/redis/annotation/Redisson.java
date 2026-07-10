package com.blue.whale.tool.redis.annotation;


import org.springframework.core.annotation.AliasFor;

import java.lang.annotation.*;
import java.util.concurrent.TimeUnit;

/**
 * Redisson
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: 锁注解
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface Redisson {
    /**
     * 锁名称 拼接成key前缀
     */
    @AliasFor("name")
    String value() default "";

    /**
     * 锁名称 拼接成key前缀
     */
    @AliasFor("value")
    String name() default "";


    /**
     * 支持 SPEl表达式
     * 批量锁每项参数名为 item
     */
    String key() default "";

    /**
     * 尝试获取锁的等待时间 默认无限等待
     */
    long waitTime() default Long.MAX_VALUE;

    /**
     * 锁时间 如果为 -1 则持续到锁主动释放
     * the maximum time to hold the lock after it's acquisition,
     * if it hasn't already been released by invoking <code>unlock</code>.
     * If leaseTime is -1, hold the lock until explicitly unlocked.
     */
    long leaseTime() default -1;

    /**
     * 时间单位 unit the time unit
     */
    TimeUnit unit() default TimeUnit.SECONDS;

    /**
     * 批量锁参数名，为空 则为单锁，不为空则为批量锁
     */
    String batchParamName() default "";


}
