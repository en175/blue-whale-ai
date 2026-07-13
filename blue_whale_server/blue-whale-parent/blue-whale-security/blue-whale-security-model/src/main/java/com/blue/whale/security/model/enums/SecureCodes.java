package com.blue.whale.security.model.enums;

import com.blue.whale.global.exception.Error;
import com.blue.whale.security.model.constants.SecureCode;
import lombok.RequiredArgsConstructor;

/**
 * SecureCodes
 *
 * @author: Jiyeon2__
 * date: 2025/03/25
 * description:
 */
@RequiredArgsConstructor
public enum SecureCodes implements Error {
    /**
     * 需要登录
     */
    NEED_LOGIN(SecureCode.NEED_LOGIN, "auth.need.login"),
    /**
     * token不可用
     */
    TOKEN_INVALID(SecureCode.TOKEN_INVALID, "auth.token.invalid"),
    /**
     * token已过期
     */
    TOKEN_EXPIRED(SecureCode.TOKEN_EXPIRED, "auth.token.expired"),
    /**
     * refresh token不可用
     */
    REFRESH_TOKEN_INVALID(SecureCode.REFRESH_TOKEN_INVALID, "auth.refresh.token.invalid"),
    /**
     * refresh token 已过期
     */
    REFRESH_TOKEN_EXPIRED(SecureCode.REFRESH_TOKEN_EXPIRED, "auth.refresh.token.expired"),
    /**
     * 权限不足
     */
    PERMISSION_DENIED(SecureCode.PERMISSION_DENIED, "auth.access.denied"),

    /**
     * 账号已过期
     */
    ACCOUNT_EXPIRED(SecureCode.ACCOUNT_EXPIRED, "auth.account.expired"),
    /**
     * 密码有误
     */
    USERNAME_PASSWORD_INVALID(SecureCode.USERNAME_PASSWORD_INVALID, "auth.username.password.invalid"),
    /**
     * clientId invalid;
     */
    CLIENT_ID_INVALID(SecureCode.CLIENT_ID_INVALID, "auth.client.id.invalid"),
    /**
     * scope invalid
     */
    SCOPE_INVALID(SecureCode.SCOPE_INVALID, "auth.scope.invalid"),
    /**
     * REQUEST_INVALID
     */
    REQUEST_INVALID(SecureCode.REQUEST_INVALID, "auth.request.invalid"),
    /**
     * UNSUPPORTED_RESPONSE_TYPE
     */
    RESPONSE_TYPE_INVALID(SecureCode.RESPONSE_TYPE_INVALID, "auth.response.type.invalid"),
    /**
     * 用户拒绝授权
     */
    ACCESS_DENIED(SecureCode.ACCESS_DENIED, "auth.access.denied"),
    /**
     * 重定向地址不可用
     */
    REDIRECT_URI_INVALID(SecureCode.REDIRECT_URI_INVALID, "auth.redirect.uri.invalid"),
    /**
     * 授权不可用
     */
    GRANT_INVALID(SecureCode.GRANT_INVALID, "auth.grant.invalid"),
    /**
     * 账号不可用
     */
    ACCOUNT_INVALID(SecureCode.ACCOUNT_INVALID, "auth.account.invalid"),
    /**
     * 服务不可用
     */
    AUTH_SERVER_ERROR(SecureCode.AUTH_SERVER_ERROR, "auth.server.error"),
    /**
     * 票据已过期
     */
    CREDENTIALS_EXPIRED(SecureCode.CREDENTIALS_EXPIRED, "auth.credentials.expired");

    private final int code;
    private final String msg;

    @Override
    public int code() {
        return code;
    }

    @Override
    public String msg() {
        return msg;
    }
}
