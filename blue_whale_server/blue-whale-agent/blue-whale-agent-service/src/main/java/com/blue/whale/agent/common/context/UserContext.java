package com.blue.whale.agent.common.context;

import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;

/**
 * 当前用户上下文：MVP 无鉴权，用户身份走 {@code X-User-Id} 请求头（网关注入，前端直传）。
 * 统一各 Controller 的未授权处理，缺失抛 {@link GlobalException}（401）。
 */
public final class UserContext {

    private UserContext() {
    }

    /** 校验 userId 非空，缺失抛未授权（401）。 */
    public static Long requireUserId(Long userId) {
        if (userId == null) {
            throw new GlobalException(SystemCode.UNAUTHORIZED_CODE, "缺少 X-User-Id 请求头");
        }
        return userId;
    }
}
