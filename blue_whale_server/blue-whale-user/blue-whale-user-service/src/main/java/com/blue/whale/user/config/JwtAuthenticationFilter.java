package com.blue.whale.user.config;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Collections;

/**
 * 认证过滤器。
 * 优先信任网关传的 X-User-Id；未经过网关时回退到 JWT 解析。
 */
@Slf4j
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtUtil jwtUtil;

    public JwtAuthenticationFilter(JwtUtil jwtUtil) {
        this.jwtUtil = jwtUtil;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain)
            throws ServletException, IOException {

        // 优先信任网关传的 X-User-Id
        String gatewayUserId = request.getHeader("X-User-Id");
        if (gatewayUserId != null && !gatewayUserId.isEmpty()) {
            UsernamePasswordAuthenticationToken authentication =
                    new UsernamePasswordAuthenticationToken(
                            gatewayUserId, null,
                            Collections.singletonList(new SimpleGrantedAuthority("ROLE_USER"))
                    );
            SecurityContextHolder.getContext().setAuthentication(authentication);
            chain.doFilter(request, response);
            return;
        }

        // 回退：直接解析 JWT（开发/调试）
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            chain.doFilter(request, response);
            return;
        }

        try {
            String token = header.substring(7);
            Claims claims = jwtUtil.parse(token);

            UsernamePasswordAuthenticationToken authentication =
                    new UsernamePasswordAuthenticationToken(
                            claims.getSubject(), null,
                            Collections.singletonList(new SimpleGrantedAuthority("ROLE_USER"))
                    );
            SecurityContextHolder.getContext().setAuthentication(authentication);

        } catch (ExpiredJwtException e) {
            log.debug("JWT 已过期: {}", e.getMessage());
            SecurityContextHolder.clearContext();
        } catch (JwtException e) {
            log.debug("JWT 无效: {}", e.getMessage());
            SecurityContextHolder.clearContext();
        }

        chain.doFilter(request, response);
    }
}
