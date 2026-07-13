package com.blue.whale.security.resource.helper;


import cn.hutool.core.util.StrUtil;
import com.alibaba.fastjson2.JSONB;
import com.alibaba.fastjson2.JSONReader;
import com.alibaba.fastjson2.JSONWriter;
import com.blue.whale.security.model.bean.SecureUser;
import com.blue.whale.security.model.constants.SecureConstant;
import com.blue.whale.security.model.enums.SecureCodes;
import com.blue.whale.security.resource.extend.IPermMatcher;
import com.blue.whale.security.resource.extend.PermMatcher;
import com.blue.whale.security.resource.extend.UserContextHolder;
import com.blue.whale.security.resource.model.TokenDetail;
import com.blue.whale.tool.redis.utils.RedisUtil;
import io.vavr.control.Option;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.provider.authentication.OAuth2AuthenticationDetails;

import java.util.Base64;
import java.util.function.Supplier;

/**
 * ISecurity
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: 安全服务工具类
 */
public interface ISecurity {
    /**
     * 匿名访问类型
     */
    Class<? extends Authentication> ANONYMOUS_CLASS = AnonymousAuthenticationToken.class;

    /**
     * token头
     */
    String HEADER = "Authorization";

    /**
     * 返回 token请求头名称
     *
     * @return 请求头名称
     */
    static String headerName() {
        return ISecurity.HEADER;
    }

    /**
     * 获取token信息
     *
     * @return token详情
     */
    static TokenDetail token() {
        OAuth2AuthenticationDetails details = ISecurity.getDetails();
        if (details == null) {
            return null;
        }
        String tokenValue = details.getTokenValue();
        String tokenType = details.getTokenType();
        return new TokenDetail()
                .setType(tokenType)
                .setValue(tokenValue);
    }

    /**
     * 获取string token信息
     *
     * @return token str
     */
    static String tokenStr() {
        TokenDetail token = ISecurity.token();
        if (token == null) {
            return null;
        }
        String type = token.getType();
        String value = token.getValue();
        return StrUtil.isBlank(type) ? value : (type + " " + value);
    }


    /**
     * 在 authentication 下 执行操作逻辑,并返回一个值
     *
     * @param authentication 认证信息
     * @param supplier       执行的任务
     * @return 任务执行结果
     */
    static <T> T withAuthentication(Authentication authentication, Supplier<T> supplier) {
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        try {
            return supplier.get();
        } finally {
            SecurityContextHolder.clearContext();
            UserContextHolder.removeUser(authentication);
        }
    }

    /**
     * 在 authentication 下 执行操作逻辑
     *
     * @param authentication 认证信息
     * @param runnable       执行任务
     */
    static void withAuthentication(Authentication authentication, Runnable runnable) {
        ISecurity.withAuthentication(
                authentication,
                () -> {
                    runnable.run();
                    return null;
                }
        );
    }

    /**
     * 获取认证信息
     * 已认证 OAuth2Authentication
     * 未认证  AnonymousAuthenticationToken
     *
     * @param allowAnonymous 是否允许匿名访问
     * @return 认证信息
     */
    static Authentication getAuthentication(boolean allowAnonymous) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (!allowAnonymous && isAnonymous(authentication)) {
            throw SecureCodes.NEED_LOGIN.exception();
        }
        return authentication;
    }

    /**
     * user信息转 principal String 格式的 用户主要信息
     *
     * @param secureUser 用户信息
     * @return principal String 格式的 用户主要信息
     */
    static String toPrincipal(SecureUser secureUser) {
        byte[] userBytes = JSONB.toBytes(
                secureUser,
                JSONWriter.Feature.FieldBased,
                JSONWriter.Feature.ErrorOnNoneSerializable,
                JSONWriter.Feature.ReferenceDetection,
                JSONWriter.Feature.NotWriteDefaultValue,
                JSONWriter.Feature.NotWriteHashMapArrayListClassName,
                JSONWriter.Feature.WriteNameAsSymbol
        );
        return Base64.getEncoder().encodeToString(userBytes);
    }

    /**
     * 获取认证详情
     *
     * @return 认证详情
     */
    static OAuth2AuthenticationDetails getDetails() {
        Authentication authentication = ISecurity.getAuthentication(true);
        if (isAnonymous(authentication)) {
            return null;
        }
        return (OAuth2AuthenticationDetails) authentication.getDetails();
    }

    /**
     * 获取 用户与权限匹配器
     *
     * @return 用户与权限匹配器
     */
    static IPermMatcher matcher() {
        return ISecurity.matcher(ISecurity.getAuthentication(true));
    }

    /**
     * 获取 用户与权限匹配器
     *
     * @param authentication 认证信息
     * @return 用户与权限匹配器
     */
    static IPermMatcher matcher(Authentication authentication) {
        return new PermMatcher(authentication);
    }

    /**
     * 获取当前用户信息
     *
     * @return 用户信息
     */
    static SecureUser secureUser() {
        return ISecurity.secureUser(ISecurity.getAuthentication(true));
    }

    /**
     * 获取可能为空的用户信息
     *
     * @return option<user>
     */
    static Option<SecureUser> userOpt() {
        SecureUser user = ISecurity.secureUser();
        if (user.isAnonymous()) {
            return Option.none();
        }
        return Option.of(user);
    }

    /**
     * 必须要有登陆认证的用户信息
     *
     * @return 当前登陆的用户信息
     */
    static SecureUser userMust() {
        Authentication authentication = getAuthentication(false);
        if (authentication == null) {
            throw SecureCodes.NEED_LOGIN.exception();
        }
        return userMust(authentication);
    }

    /**
     * 必须要有登陆认证的用户信息
     *
     * @param authentication 认证信息
     * @return 当前登陆的用户信息
     */
    static SecureUser userMust(@NonNull Authentication authentication) {
        SecureUser user = ISecurity.matcher(authentication)
                .getUser();
        if (user.isAnonymous()) {
            throw SecureCodes.NEED_LOGIN.exception();
        }
        return user;
    }

    /**
     * 根据指定的认证信息 获取当前用户信息
     *
     * @param authentication 认证信息
     * @return 用户信息
     */
    static SecureUser secureUser(@NonNull Authentication authentication) {
        return ISecurity.matcher(authentication)
                .getUser();
    }

    /**
     * 取出用户信息
     *
     * @return 可以为空的用户信息
     * @deprecated 推荐使用 userOpt 或 userMust
     */
    @Deprecated
    static Option<SecureUser> user() {
        return Option.of(userOpt().getOrNull());
    }


    /**
     * 是否是匿名访问
     *
     * @param authentication 认证信息
     * @return 是否是匿名访问
     */
    static boolean isAnonymous(Authentication authentication) {
        return authentication == null || ANONYMOUS_CLASS.isAssignableFrom(authentication.getClass());
    }

    /**
     * 是否是匿名访问
     *
     * @return 是否是匿名访问
     */
    static boolean isAnonymous() {
        return ISecurity.matcher().getUser().isAnonymous();
    }

    /**
     * 是否已认证
     *
     * @return 是否已认证
     */
    static boolean isAuthenticated() {
        return !ISecurity.isAnonymous();
    }

    /**
     * principal String 格式的 用户主要信息 转 user信息
     *
     * @param principal principal String 格式的 用户主要信息
     * @return user信息
     */
    static SecureUser toUser(String principal) {
        return JSONB.parseObject(
                Base64.getDecoder().decode(principal),
                SecureUser.class,
                JSONReader.Feature.UseDefaultConstructorAsPossible,
                JSONReader.Feature.ErrorOnNoneSerializable,
                JSONReader.Feature.IgnoreAutoTypeNotMatch,
                JSONReader.Feature.UseNativeObject,
                JSONReader.Feature.FieldBased);
    }

    /**
     * 新增公司id下的用户 上线
     *
     * @param companyId 公司id
     * @param userId    用户id列表
     */
    static void onlineUser(Long companyId, Long userId) {
        String key = RedisUtil.key(SecureConstant.USER_LOGIN_STATE_CHECK, String.valueOf(companyId));
        RedisUtil.getRedisTemplate()
                .opsForSet()
                .add(key, userId);
    }

    /**
     * 下线公司id下的用户
     *
     * @param companyId 公司id
     * @param userIds   用户id列表
     */
    static void offlineUsers(Long companyId, Object... userIds) {
        String key = RedisUtil.key(SecureConstant.USER_LOGIN_STATE_CHECK, String.valueOf(companyId));

        RedisUtil.getRedisTemplate()
                .opsForSet()
                .remove(key, userIds);
    }
}
