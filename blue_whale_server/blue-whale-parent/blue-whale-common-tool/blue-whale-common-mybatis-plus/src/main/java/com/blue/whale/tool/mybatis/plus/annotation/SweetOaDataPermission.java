package com.blue.whale.tool.mybatis.plus.annotation;


import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * DataPermission
 *
 * @author: Jiyeon2__
 * date: 2025/4/2
 * description: 数据权限注解
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface SweetOaDataPermission {
}
