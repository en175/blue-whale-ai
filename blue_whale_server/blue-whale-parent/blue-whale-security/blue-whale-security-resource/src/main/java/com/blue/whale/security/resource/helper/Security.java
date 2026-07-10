package com.blue.whale.security.resource.helper;


import com.blue.whale.security.model.bean.SecureUser;
import com.blue.whale.security.resource.extend.IPermMatcher;
import org.springframework.stereotype.Component;

import java.util.Set;
import java.util.function.Function;

/**
 * Security
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description:
 */
@Component("S")
public class Security {

    /**
     * 获取用户权限集合 func
     */
    public static final Function<SecureUser, Set<String>> PERMS = SecureUser::getPerms;

    /**
     * 权限匹配器
     *
     * @return IPermMatcher 权限匹配器
     */
    public IPermMatcher matcher() {
        return ISecurity.matcher();
    }

    /**
     * 是否已认证
     */
    public boolean isAuthenticated() {
        return ISecurity.isAuthenticated();
    }

    /**
     * 允许所有人访问
     */
    public boolean permitAll() {
        return true;
    }

    public boolean hasPerm(String... perms) {
        return ISecurity.matcher()
                .any(SecureUser::getPerms, perms)
                .match();
    }
}
