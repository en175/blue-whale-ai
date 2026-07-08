package com.blue.whale.security.resource.exception;


import com.blue.whale.global.base.resp.Result;
import com.blue.whale.global.i18n.I18N;
import com.blue.whale.security.model.enums.SecureCodes;
import com.blue.whale.security.resource.utils.ResponseUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.common.exceptions.OAuth2Exception;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;

import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;

/**
 * ExceptionAccessDeniedHandler
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: 访问被拒绝处理程序
 */
@Slf4j
@Component
public class ExceptionAccessDeniedHandler implements AccessDeniedHandler {

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, AccessDeniedException ex) throws IOException, ServletException {
        log.error("ExceptionAccessDeniedHandler", ex);
        Throwable cause = ex.getCause();
        ResponseUtil.response(
                response,
                (cause instanceof OAuth2Exception) ?
                        SecureExceptionAdvice.oauth2ExceptionMapping(cause) :
                        Result.failed(SecureCodes.ACCESS_DENIED, I18N.msg("auth.access.denied"))
        );

    }

}
