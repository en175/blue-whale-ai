package com.blue.whale.security.model.constants;

import com.blue.whale.global.constants.GlobalCodeConstant;

/**
 * SecureCode
 *
 * @author: Jiyeon2__
 * date: 2024/8/14
 * description:
 */
public interface SecureCode {
    /**
     * 需要登录
     */
    int NEED_LOGIN = 2;
    /**
     * token不可用
     */
    int TOKEN_INVALID = 3;
    /**
     * token已过期
     */
    int TOKEN_EXPIRED = 4;
    /**
     * refresh token不可用
     */
    int REFRESH_TOKEN_INVALID = 5;
    /**
     * refresh token 已过期
     */
    int REFRESH_TOKEN_EXPIRED = 6;
    /**
     * 权限不足
     */
    int PERMISSION_DENIED = 7;

    /**
     * 账号已过期
     */
    int ACCOUNT_EXPIRED = 8;
    /**
     * 密码有误
     */
    int USERNAME_PASSWORD_INVALID = 9;

    /**
     * clientId invalid;
     */
    int CLIENT_ID_INVALID = 10;
    /**
     * scope invalid
     */
    int SCOPE_INVALID = 11;
    /**
     * REQUEST_INVALID
     */
    int REQUEST_INVALID = GlobalCodeConstant.REQUEST_INVALID;
    /**
     * UNSUPPORTED_RESPONSE_TYPE
     */
    int RESPONSE_TYPE_INVALID = 13;
    /**
     * 拒绝访问
     */
    int ACCESS_DENIED = 14;
    /**
     * 重定向地址不可用
     */
    int REDIRECT_URI_INVALID = 15;
    /**
     * 授权不可用
     */
    int GRANT_INVALID = 16;
    /**
     * 账号不可用
     */
    int ACCOUNT_INVALID = 17;
    /**
     * 服务不可用
     */
    int AUTH_SERVER_ERROR = 18;
    /**
     * 票据已过期
     */
    int CREDENTIALS_EXPIRED = 19;

    /**
     * 无效的验证码
     */
    int SMS_CAPTCHA_INVALID = 20;

    /**
     * 用户拒绝授权
     */
    int USER_DENIED_AUTHORIZATION = 21;

}
