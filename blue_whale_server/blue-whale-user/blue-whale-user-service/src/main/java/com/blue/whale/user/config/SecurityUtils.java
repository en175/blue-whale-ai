package com.blue.whale.user.config;

import com.blue.whale.global.exception.GlobalException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * Security 工具类：从 SecurityContext 取当前用户
 */
public final class SecurityUtils {

    private SecurityUtils() {
    }

    /** 系统内置错误码 */
    private static final int UNAUTHORIZED_CODE = 401;

    /**
     * 获取当前用户 ID
     *
     * @return user_id (Long)
     * @throws GlobalException 未登录
     */
    public static Long getCurrentUserId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || "anonymousUser".equals(auth.getPrincipal())) {
            throw new GlobalException(UNAUTHORIZED_CODE, "未登录");
        }
        return Long.valueOf((String) auth.getPrincipal());
    }

    /**
     * 是否已登录
     */
    public static boolean isAuthenticated() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        return auth != null && auth.isAuthenticated()
                && !"anonymousUser".equals(auth.getPrincipal());
    }
}
