package com.blue.whale.user.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import javax.servlet.http.HttpServletResponse;

/**
 * Spring Security 配置
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    /**
     * Security 过滤器链
     */
    @Bean
    public SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            JwtAuthenticationFilter jwtFilter
    ) throws Exception {
        http
                // 无状态，不用 Session
                .sessionManagement(session ->
                        session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))

                // 禁用 CSRF（REST API）
                .csrf().disable()

                // URL 权限
                .authorizeRequests()
                .antMatchers("/api/auth/send-code", "/api/auth/login", "/api/auth/refresh").permitAll()
                .antMatchers("/api/**").authenticated()
                .anyRequest().permitAll()

                // 异常处理 → JSON
                .and()
                .exceptionHandling()
                .authenticationEntryPoint(authenticationEntryPoint())
                .accessDeniedHandler(accessDeniedHandler())

                // 插 JWT Filter
                .and()
                .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class)

                // 禁用表单登录
                .formLogin().disable()
                .httpBasic().disable();

        return http.build();
    }

    /**
     * 401 未登录 → JSON
     */
    @Bean
    public AuthenticationEntryPoint authenticationEntryPoint() {
        return (request, response, authException) -> {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write(
                    "{\"code\":401,\"msg\":\"未登录或 token 已过期\",\"data\":null}"
            );
        };
    }

    /**
     * 403 无权限 → JSON
     */
    @Bean
    public AccessDeniedHandler accessDeniedHandler() {
        return (request, response, accessDeniedException) -> {
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write(
                    "{\"code\":403,\"msg\":\"无权限访问该资源\",\"data\":null}"
            );
        };
    }
}
