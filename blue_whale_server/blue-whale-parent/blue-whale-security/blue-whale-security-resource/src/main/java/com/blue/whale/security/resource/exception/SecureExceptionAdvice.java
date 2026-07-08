package com.blue.whale.security.resource.exception;


import cn.hutool.core.util.StrUtil;
import com.blue.whale.global.base.resp.Result;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.global.i18n.I18N;
import com.blue.whale.security.model.constants.SecureCode;
import com.blue.whale.security.resource.helper.ISecurity;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.*;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.oauth2.client.resource.OAuth2AccessDeniedException;
import org.springframework.security.oauth2.common.exceptions.*;
import org.springframework.security.oauth2.provider.token.store.jwk.JwkException;
import org.springframework.security.oauth2.server.resource.InvalidBearerTokenException;
import org.springframework.security.web.authentication.rememberme.RememberMeAuthenticationException;
import org.springframework.security.web.authentication.session.SessionAuthenticationException;
import org.springframework.security.web.authentication.www.NonceExpiredException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * SecureExceptionAdvice
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: 异常处理器
 */
@Slf4j
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice
public class SecureExceptionAdvice {

    public static Result<Void> oauth2ExceptionMapping(Throwable ex) {
        if (isMachInstance(ex, InvalidGrantException.class)) {
            return Result.failed(SecureCode.USERNAME_PASSWORD_INVALID, I18N.msg("auth.username.password.invalid"));
        }
        if (isMachInstance(ex, UserDeniedAuthorizationException.class)) {
            return Result.failed(SecureCode.USER_DENIED_AUTHORIZATION, I18N.msg("auth.user.denied.authorization"));
        }
        if (isMachInstance(ex, BadClientCredentialsException.class, InvalidClientException.class, UnauthorizedClientException.class)) {
            return Result.failed(SecureCode.CLIENT_ID_INVALID, I18N.msg("auth.client.password.invalid"));
        }
        if (isMachInstance(ex, InsufficientScopeException.class, InvalidScopeException.class)) {
            return Result.failed(SecureCode.SCOPE_INVALID, I18N.msg("auth.scope.invalid"));
        }
        if (isMachInstance(ex, InvalidTokenException.class)) {
            return StrUtil.startWith(ex.getMessage(), "Access token expired") ?
                    Result.failed(SecureCode.TOKEN_EXPIRED, I18N.msg("auth.token.expired")) :
                    Result.failed(SecureCode.TOKEN_INVALID, I18N.msg("auth.token.invalid"));
        }
        if (isMachInstance(ex, InvalidRequestException.class, JwkException.class)) {
            return Result.failed(SecureCode.REQUEST_INVALID, I18N.msg("auth.request.invalid"));
        }
        if (isMachInstance(ex, RedirectMismatchException.class)) {
            return Result.failed(SecureCode.REDIRECT_URI_INVALID, I18N.msg("auth.redirect.uri.invalid"));
        }
        if (isMachInstance(ex, OAuth2AccessDeniedException.class)) {
            return Result.failed(SecureCode.ACCESS_DENIED, I18N.msg("auth.access.denied"));
        }
        if (isMachInstance(ex, UnauthorizedUserException.class)) {
            return Result.failed(SecureCode.NEED_LOGIN, I18N.msg("auth.need.login"));
        }
        if (isMachInstance(ex, UnsupportedGrantTypeException.class)) {
            return Result.failed(SecureCode.GRANT_INVALID, I18N.msg("auth.grant.invalid"));
        }
        if (isMachInstance(ex, UnsupportedResponseTypeException.class)) {
            return Result.failed(SecureCode.RESPONSE_TYPE_INVALID, I18N.msg("auth.response.type.invalid"));
        }
        return Result.failed(ex.getMessage());
    }

    public static Result<Void> authExceptionMapping(Throwable ex) {
        if (ex instanceof OAuth2Exception) {
            return oauth2ExceptionMapping(ex);
        }
        if (ex.getCause() instanceof OAuth2Exception) {
            return oauth2ExceptionMapping(ex.getCause());
        }
        if (ex instanceof InsufficientAuthenticationException) {
            if (ex instanceof UnapprovedClientAuthenticationException) {
                return Result.failed(SecureCode.CLIENT_ID_INVALID, I18N.msg("auth.client.password.invalid"));
            }
            return Result.failed(SecureCode.NEED_LOGIN, I18N.msg("auth.need.login"));
        }

        if (
                ex instanceof BadCredentialsException ||
                        ex instanceof AuthenticationCredentialsNotFoundException ||
                        ex instanceof UsernameNotFoundException
        ) {
            return Result.failed(SecureCode.USERNAME_PASSWORD_INVALID, I18N.msg("auth.username.password.invalid"));
        }

        if (ex instanceof AccountExpiredException) {
            return Result.failed(SecureCode.ACCOUNT_EXPIRED, I18N.msg("auth.account.expired"));
        }

        if (ex instanceof InternalAuthenticationServiceException) {
            if (ex.getCause() instanceof AccessDeniedException) {
                return Result.failed(SecureCode.ACCESS_DENIED, I18N.msg("auth.access.denied"));
            }
        }

        if (ex instanceof AuthenticationServiceException authenticationServiceException) {
            if (authenticationServiceException.getCause() instanceof GlobalException gex) {
                return Result.failed(gex);
            }
            return Result.failed(SecureCode.AUTH_SERVER_ERROR, I18N.msg("auth.server.error"));
        }
        if (ex instanceof RememberMeAuthenticationException || ex instanceof SessionAuthenticationException) {
            return Result.failed(SecureCode.REQUEST_INVALID, I18N.msg("auth.request.invalid"));
        }

        if (ex instanceof CredentialsExpiredException) {
            return Result.failed(SecureCode.CREDENTIALS_EXPIRED, I18N.msg("auth.credentials.expired"));
        }
        if (ex instanceof DisabledException || ex instanceof LockedException) {
            return Result.failed(SecureCode.ACCOUNT_INVALID, I18N.msg("auth.account.invalid"));
        }
        if (ex instanceof InvalidBearerTokenException || ex instanceof NonceExpiredException) {
            return Result.failed(SecureCode.TOKEN_INVALID, I18N.msg("auth.token.invalid"));
        }

        return Result.failed(SecureCode.PERMISSION_DENIED, I18N.msg("auth.access.denied"));
    }

    /**
     * 判断ex 是否在classes实现类型中
     */
    public static boolean isMachInstance(Object ex, Class<?>... classes) {
        for (Class<?> clazz : classes) {
            if (clazz.isAssignableFrom(ex.getClass())) {
                return true;
            }
        }
        return false;
    }

    @ExceptionHandler(AccessDeniedException.class)
    public Result<Void> accessDeniedException(AccessDeniedException ex) {
        log.debug("AccessDeniedException", ex);
        Throwable cause = ex.getCause();
        if (ISecurity.isAnonymous()) {
            return Result.failed(SecureCode.NEED_LOGIN, I18N.msg("auth.need.login"));
        }
        if (cause != null) {
            if (cause instanceof AuthenticationException) {
                return SecureExceptionAdvice.authExceptionMapping(cause);
            }
            if (cause instanceof OAuth2Exception) {
                return SecureExceptionAdvice.oauth2ExceptionMapping(cause);
            }
        }
        return Result.failed(SecureCode.PERMISSION_DENIED, I18N.msg("auth.access.denied"));
    }

    /**
     * OAuth2Exception 异常
     */
    @ExceptionHandler(OAuth2Exception.class)
    public Result<Void> oauth2Exception(OAuth2Exception ex) {
        log.debug("OAuth2Exception", ex);
        return SecureExceptionAdvice.oauth2ExceptionMapping(ex);
    }

    /**
     * AuthenticationException 认证服务异常
     */
    @ExceptionHandler(AuthenticationException.class)
    public Result<Void> authException(AuthenticationException ex) {
        log.debug("AuthenticationException", ex);
        return SecureExceptionAdvice.authExceptionMapping(ex);
    }
}
