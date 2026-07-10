package com.blue.whale.tool.log.annotation;


import org.springframework.boot.logging.LogLevel;

import java.lang.annotation.*;

/**
 * Log
 *
 * @author: Jiyeon2__
 * date: 2025/3/26
 * description: 打印日志注解
 */
@Target({ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Inherited
@Documented
public @interface Log {

    /**
     * 日志描述
     */
    String value() default "";

    /**
     * 日志级别
     */
    LogLevel level() default LogLevel.DEBUG;

    /**
     * 请求头名称
     */
    String[] headers() default {};
}
