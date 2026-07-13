package com.blue.whale.tool.fastjson2.annotation;


import cn.hutool.core.util.DesensitizedUtil;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Desensitize
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: 数据脱敏注解 只针对 string类型字段
 */
@Target({ElementType.FIELD})
@Retention(RetentionPolicy.RUNTIME)
public @interface Desensitize {

    /**
     * 脱敏类型
     *
     * @return DesensitizedUtil.DesensitizedType
     */
    DesensitizedUtil.DesensitizedType type() default DesensitizedUtil.DesensitizedType.CHINESE_NAME;

    /**
     * 脱敏开始位置
     *
     * @return int
     */
    int start() default -1;

    /**
     * 脱敏结束位置
     *
     * @return int
     */
    int end() default -1;

    /**
     * 正则表达式 脱敏 通过正则查找到字符串，template，$1表示分组1的字符串
     */
    String regx() default "";

    /**
     * 替代模板
     */
    String template() default "";
}