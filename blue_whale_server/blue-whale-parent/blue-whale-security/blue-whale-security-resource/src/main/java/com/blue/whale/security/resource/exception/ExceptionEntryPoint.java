package com.blue.whale.security.resource.exception;

import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.provider.error.OAuth2AuthenticationEntryPoint;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;

/**
 * ExceptionEntryPoint
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: 认证异常处理
 */
@Slf4j
public class ExceptionEntryPoint extends OAuth2AuthenticationEntryPoint {

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response, AuthenticationException ex) throws IOException {
        log.error("ExceptionEntryPoint", ex);
        ResponseUtil.response(response, SecureExceptionAdvice.authExceptionMapping(ex));
    }
}
