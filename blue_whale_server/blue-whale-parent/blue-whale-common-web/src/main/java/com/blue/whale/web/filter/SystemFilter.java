package com.blue.whale.web.filter;

import cn.hutool.core.text.StrPool;
import cn.hutool.core.util.StrUtil;
import com.blue.whale.web.constant.SystemHeaders;
import com.blue.whale.web.context.SystemContextHolder;
import com.blue.whale.web.model.Systems;
import com.blue.whale.web.utils.IpUtils;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;

/**
 * SystemFilter
 *
 * @author: Jiyeon2__
 * date: 2024/8/15
 * description:
 */
@Slf4j
@Order(Integer.MIN_VALUE + 100)
public class SystemFilter extends AbstractServletFilter {

    private static final String ICO = "/favicon.ico";

    public static void setContextHolder(
            String uri,
            String ip,
            String deviceId,
            String companyId
    ) {
        String logFormat = """
                \nURI    : {}
                Client : [ip:{},deviceId:{}],
                Tenants: [companyId:{}]""";
        log.debug(
                logFormat,
                uri, ip, deviceId, companyId
        );
        SystemContextHolder.set(
                new Systems()
                        .setIp(ip)
                        .setCompanyId(StrUtil.isBlank(companyId) ? null : Long.valueOf(companyId))
        );

    }

    @Override
    public void doFilter(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain) throws IOException, ServletException {
        if (ICO.equals(request.getRequestURI())) {
            response.setStatus(HttpStatus.NOT_FOUND.value());
            response.getWriter().flush();
            return;
        }

        SystemFilter.setContextHolder(
                request.getMethod() + StrPool.C_SPACE + request.getRequestURI(),
                IpUtils.getIpAddr(request),
                request.getHeader(SystemHeaders.DEVICE_ID),
                request.getHeader(SystemHeaders.COMPANY_ID)
        );
        try {
            filterChain.doFilter(request, response);
        } finally {
            this.clearAll();
        }
    }

    private void clearAll() {
        SystemContextHolder.clear();
    }
}
