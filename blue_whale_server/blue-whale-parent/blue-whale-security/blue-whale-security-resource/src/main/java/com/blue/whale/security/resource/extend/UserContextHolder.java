package com.blue.whale.security.resource.extend;


import com.blue.whale.global.constants.CommonPool;
import com.blue.whale.security.model.bean.SecureUser;
import org.springframework.security.core.Authentication;

import java.util.HashMap;
import java.util.Map;

/**
 * UserContextHolder
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: 用户上下文
 */
public class UserContextHolder {

    private static final ThreadLocal<Map<Authentication, SecureUser>> USER_HOLDER = new ThreadLocal<>();

    /**
     * 获取当前用户
     *
     * @return SecureUser
     */
    public static SecureUser getUser(Authentication authentication) {
        return getContext().get(authentication);
    }


    /**
     * 设置当前用户
     *
     * @param user 用户
     * @return SecureUser
     */
    public static SecureUser setUser(Authentication authentication, SecureUser user) {
        getContext().put(authentication, user);
        return user;
    }

    /**
     * 移除认证信息对应用户
     *
     * @param authentication 认证信息
     */
    public static void removeUser(Authentication authentication) {
        Map<Authentication, SecureUser> context = getContext();
        context.remove(authentication);
        if (context.isEmpty()) {
            clear();
        }
    }

    /**
     * 获取当先用户上下文
     *
     * @return Map 用户上下文
     */
    public static Map<Authentication, SecureUser> getContext() {
        Map<Authentication, SecureUser> authenticationSecureUserMap = USER_HOLDER.get();
        if (authenticationSecureUserMap == null) {
            authenticationSecureUserMap = new HashMap<>(CommonPool.NUMBER_SEVEN);
            USER_HOLDER.set(authenticationSecureUserMap);
        }
        return authenticationSecureUserMap;
    }

    /**
     * 清除当前用户
     */
    public static void clear() {
        USER_HOLDER.remove();
    }
}
