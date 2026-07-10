package com.blue.whale.web.filter;


import org.springframework.web.filter.GenericFilterBean;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;

/**
 * AbstractServletFilter
 *
 * @author: Jiyeon2__
 * date: 2025/4/1
 * description:
 */
public abstract class AbstractServletFilter extends GenericFilterBean {
    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse, FilterChain filterChain) throws IOException, ServletException {
        HttpServletRequest request = (HttpServletRequest) servletRequest;
        HttpServletResponse response = (HttpServletResponse) servletResponse;
        this.doFilter(request, response, filterChain);
    }

    /**
     * 子类实现
     * @param request request
     * @param response response
     * @param filterChain chain
     * @throws IOException IO流异常
     * @throws ServletException servlet异常
     */
    public abstract void doFilter( HttpServletRequest request,HttpServletResponse response ,FilterChain filterChain) throws IOException, ServletException;
}
