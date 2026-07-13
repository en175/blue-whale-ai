package com.blue.whale.security.resource.config;


import cn.hutool.core.util.BooleanUtil;
import com.blue.whale.security.model.bean.SecureUser;
import com.blue.whale.security.model.constants.SecureCode;
import com.blue.whale.security.model.constants.SecureConstant;
import com.blue.whale.security.model.enums.SecureCodes;
import com.blue.whale.security.resource.extend.UserContextHolder;
import com.blue.whale.security.resource.helper.ISecurity;
import com.blue.whale.tool.redis.utils.RedisUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.lang.NonNull;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

/**
 * ClientAndTokenStateConfig
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: 有状态token
 */
@ConditionalOnClass(name = {"org.springframework.data.redis.core.StringRedisTemplate", "com.medusa.gruul.common.system.model.ISystem"})
@RequiredArgsConstructor
public class ClientAndTokenStateConfig implements WebMvcConfigurer {


    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new TokenStateHandlerInterceptor())
                .addPathPatterns("/**")
                .excludePathPatterns("/error");
    }

    public static class TokenStateHandlerInterceptor implements HandlerInterceptor {


        @Override
        public boolean preHandle(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response, @NonNull Object handler) {
            //用户的登录信息 并把用户信息缓存在上下文中
            SecureUser user = UserContextHolder.setUser(ISecurity.getAuthentication(true), ISecurity.matcher().getUser());
            if (user.isAnonymous()) {
                return true;
            }

            //检查用户登录状态
            checkUserLogin(user.getCompanyId(), user.getId());
            return true;
        }


        @Override
        public void afterCompletion(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response, @NonNull Object handler, Exception ex) {
            //清除用户信息
            UserContextHolder.clear();
        }

        private void checkUserLogin(Long companyId, Long userId) {
            String key = RedisUtil.key(SecureConstant.USER_LOGIN_STATE_CHECK, String.valueOf(companyId));
            Boolean isMember = RedisUtil.getRedisTemplate().opsForSet().isMember(key, userId);
            if (!BooleanUtil.isTrue(isMember)) {
                throw SecureCodes.NEED_LOGIN.exception();
            }
        }
    }
}