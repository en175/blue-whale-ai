package com.blue.whale.security.resource.extend;


import com.blue.whale.security.model.bean.SecureUser;

import java.util.Set;
import java.util.function.Consumer;
import java.util.function.Function;

/**
 * IPermMatcher
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: 权限匹配接口
 */
public interface IPermMatcher {

    /**
     * 开启允许匿名访问
     *
     * @return IPermMatcher 条件组装器
     */
    IPermMatcher anonymous();

    /**
     * 是否包含任意权限
     *
     * @param condition 权限条件
     * @param property  权限列
     * @return IPermMatcher 条件组装器
     */
    <T> IPermMatcher neq(Function<SecureUser, Set<T>> property, T condition);

    /**
     * 是否包含任意权限
     *
     * @param condition 权限条件
     * @param property  权限列
     * @return IPermMatcher 条件组装器
     */
    <T> IPermMatcher eq(Function<SecureUser, Set<T>> property, T condition);

    /**
     * 是否包含任意权限
     *
     * @param conditions 权限条件
     * @param property   权限列
     * @return IPermMatcher 条件组装器
     */
    @SuppressWarnings("unchecked")
    <T> IPermMatcher any(Function<SecureUser, Set<T>> property, T... conditions);

    /**
     * 匹配所有权限
     *
     * @param conditions 条件权限
     * @param property   权限列
     * @return IPermMatcher 条件组装器
     */
    @SuppressWarnings("unchecked")
    <T> IPermMatcher all(Function<SecureUser, Set<T>> property, T... conditions);

    /**
     * and 条件
     *
     * @param and 条件组装器
     * @return IPermMatcher 条件组装器
     */
    IPermMatcher and(Consumer<IPermMatcher> and);

    /**
     * or 条件
     *
     * @param or 条件组装器
     * @return IPermMatcher 条件组装器
     */
    IPermMatcher or(Consumer<IPermMatcher> or);

    /**
     * 自定义条件匹配
     *
     * @param custom 自定义条件
     *               true 匹配成功
     *               false 匹配失败
     *               null  不参与匹配
     * @return IPermMatcher 条件组装器
     */
    IPermMatcher custom(Function<IPermMatcher, Boolean> custom);

    /**
     * 获取用户 信息
     *
     * @return SecureUser 用户信息
     */
    SecureUser getUser();

    /**
     * 计算结果 执行匹配
     *
     * @return 是否匹配成功
     */
    boolean match();
}
