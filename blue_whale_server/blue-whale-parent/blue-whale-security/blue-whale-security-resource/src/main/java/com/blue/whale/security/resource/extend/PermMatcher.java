package com.blue.whale.security.resource.extend;


import cn.hutool.core.util.StrUtil;
import com.blue.whale.global.constants.CommonPool;
import com.blue.whale.security.model.bean.SecureUser;
import com.blue.whale.security.model.bean.UserMatch;
import com.blue.whale.security.model.enums.SecureCodes;
import com.blue.whale.security.resource.helper.ISecurity;
import io.vavr.Tuple2;
import lombok.Getter;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;

import java.util.HashSet;
import java.util.Set;
import java.util.function.Consumer;
import java.util.function.Function;

/**
 * PermMatcher
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: 权限匹配器
 */
public class PermMatcher implements IPermMatcher {

    /**
     * 当前用户
     */
    @Getter
    private final SecureUser user;

    /**
     * 匹配结果
     */
    private boolean success = true;

    /**
     * or 条件初始化兼容
     */
    private boolean orFirst = true;

    public PermMatcher(Authentication authentication) {
        // 从上下文中获取用户信息
        SecureUser secureUser = UserContextHolder.getUser(authentication);
        // 如果上下文中有用户信息，则直接使用
        if (secureUser != null) {
            this.user = secureUser;
            return;
        }
        // 如果上下文中没有用户信息，则从authentication中获取
        Set<String> perms = this.perms(authentication);
        this.user = this.user(authentication);
        this.user.setPerms(perms);
        // 将用户信息放入上下文中
        UserContextHolder.setUser(authentication, this.user);
    }

    private PermMatcher(SecureUser user) {
        this.user = user;
    }

    /**
     * 获取指定用户的的所有角色集合 与权限集合
     *
     * @param authentication 认证信息 非匿名认证信息
     * @return 权限集合
     */
    private Set<String> perms(Authentication authentication) {
        if (ISecurity.isAnonymous(authentication)) {
            return Set.of();
        }
        Set<String> ownPerms = new HashSet<>(CommonPool.NUMBER_FIFTEEN);
        for (GrantedAuthority authority : authentication.getAuthorities()) {
            String auth = authority.getAuthority();
            ownPerms.add(auth);
        }
        return ownPerms;
    }

    private SecureUser user(Authentication authentication) {
        if (ISecurity.isAnonymous(authentication)) {
            return new SecureUser();
        }
        String userStr;
        if (StrUtil.isBlank(userStr = (String) authentication.getPrincipal())) {
            throw SecureCodes.NEED_LOGIN.exception();
        }
        return ISecurity.toUser(userStr);
    }

    /**
     * 条件组装器 匿名用户
     *
     * @return {@link PermMatcher} 条件组装器
     */
    @Override
    public IPermMatcher anonymous() {
        if (success()) {
            this.updateSuccess(user.isAnonymous());
        }
        return this;
    }


    /**
     * 条件组装器 且  必须不包含
     *
     * @param property  权限/角色列
     * @param condition 权限条件
     * @param <T>       权限/角色类型
     * @return {@link IPermMatcher} 条件组装器
     */
    @Override
    public <T> IPermMatcher neq(Function<SecureUser, Set<T>> property, T condition) {
        if (success()) {
            this.updateSuccess(!property.apply(user).contains(condition));
        }
        return this;
    }

    /**
     * 条件组装器 且  必须包含匹配
     *
     * @param property  权限/角色列
     * @param condition 权限条件
     * @param <T>       权限/角色类型
     * @return {@link IPermMatcher} 条件组装器
     */
    @Override
    public <T> IPermMatcher eq(Function<SecureUser, Set<T>> property, T condition) {
        if (success()) {
            this.updateSuccess(property.apply(user).contains(condition));
        }
        return this;
    }

    /**
     * 条件组装器 且  任一条件包含匹配
     *
     * @param property   权限/角色列
     * @param conditions 权限条件
     * @param <T>        权限/角色类型
     * @return {@link IPermMatcher} 条件组装器
     */
    @SafeVarargs
    @Override
    public final <T> IPermMatcher any(Function<SecureUser, Set<T>> property, T... conditions) {
        if (success()) {
            Set<T> roleOrPerms = property.apply(user);
            Set<Object> conditionsSet = Set.of(conditions);
            this.updateSuccess(roleOrPerms.stream().anyMatch(conditionsSet::contains));
        }
        return this;
    }

    /**
     * 条件组装器 且  所有条件都包含匹配
     *
     * @param property   权限/角色列
     * @param conditions 条件权限
     * @param <T>        权限/角色类型
     * @return {@link IPermMatcher} 条件组装器
     */
    @Override
    @SafeVarargs
    public final <T> IPermMatcher all(Function<SecureUser, Set<T>> property, T... conditions) {
        if (success()) {
            Set<T> perms = property.apply(user);
            this.updateSuccess(perms.containsAll(Set.of(conditions)));
        }
        return this;
    }

    /**
     * 条件组装器 且
     *
     * @param and 条件组装器
     * @return {@link IPermMatcher} 条件组装器
     */
    @Override
    public IPermMatcher and(Consumer<IPermMatcher> and) {
        if (success()) {
            PermMatcher permMatcher = new PermMatcher(user);
            and.accept(permMatcher);
        }
        return this;
    }

    /**
     * 条件组装器 或
     *
     * @param or 条件组装器
     * @return {@link IPermMatcher} 条件组装器
     */
    @Override
    public IPermMatcher or(Consumer<IPermMatcher> or) {
        if (orFirst || !success()) {
            PermMatcher permMatcher = new PermMatcher(user);
            or.accept(permMatcher);
        }
        return this;
    }

    @Override
    public IPermMatcher custom(Function<IPermMatcher, Boolean> custom) {
        Boolean success = custom.apply(this);
        if (success != null) {
            this.updateSuccess(success);
        }
        return this;
    }

    @Override
    public boolean match() {
        return success;
    }

    private void updateSuccess(boolean success) {
        this.success = success;
        this.orFirst = false;
    }

    /**
     * 是否匹配成功
     *
     * @return boolean 是否匹配成功 true:匹配成功 false:匹配失败
     */
    public boolean success() {
        return success;
    }
}
