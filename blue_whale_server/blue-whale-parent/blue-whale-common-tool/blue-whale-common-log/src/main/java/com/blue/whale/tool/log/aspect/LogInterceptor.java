package com.blue.whale.tool.log.aspect;


import cn.hutool.core.date.TimeInterval;
import cn.hutool.core.thread.ThreadUtil;
import cn.hutool.core.util.ArrayUtil;
import cn.hutool.core.util.StrUtil;
import com.blue.whale.tool.log.annotation.Log;
import com.blue.whale.tool.log.properties.LogProperties;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.Setter;
import lombok.experimental.Accessors;
import lombok.extern.slf4j.Slf4j;
import org.aopalliance.intercept.MethodInterceptor;
import org.aopalliance.intercept.MethodInvocation;
import org.springframework.boot.logging.LogLevel;
import org.springframework.core.annotation.AnnotationUtils;
import org.springframework.lang.NonNull;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.http.HttpServletRequest;
import java.lang.reflect.Method;
import java.util.*;

/**
 * LogInterceptor
 *
 * @author: Jiyeon2__
 * date: 2025/3/26
 * description: 日志拦截器
 */
@Slf4j
@RequiredArgsConstructor
public class LogInterceptor implements MethodInterceptor {

    private final LogProperties properties;

    @Override
    public Object invoke(@NonNull MethodInvocation invocation) throws Throwable {
        log.debug("@Log annotation aspect working...");

        Log logAnnotation = this.getLogAnnotation(invocation.getMethod());
        if (logAnnotation == null) {
            return invocation.proceed();
        }
        boolean logEnable = isLogEnable(logAnnotation.level());
        //不能打印该级别日志 直接返回执行结果
        if (!logEnable) {
            return invocation.proceed();
        }
        Object invokeResult;
        TimeInterval timer = new TimeInterval();
        try {
            invokeResult = invocation.proceed();
        } catch (Exception exception) {
            invokeResult = exception;
        }
        long timeConsuming = timer.intervalMs();
        boolean hashError = invokeResult instanceof Exception;
        final Object result = hashError ? invokeResult : invocation.getMethod().getReturnType() == void.class ? void.class : invokeResult;
        /*
         * 异步打印
         */
//        Request requestInfo = requestInfo(ISystem.ipOpt().getOrNull(), Thread.currentThread().getName());
        Request requestInfo = requestInfo(null, Thread.currentThread().getName());
        ThreadUtil.execute(() -> this.renderAndPrintLog(logAnnotation, requestInfo, result, invocation, timeConsuming));
        if (hashError) {
            throw (Exception) invokeResult;
        }
        return invokeResult;
    }

    private Request requestInfo(String ip, String threadName) {
        ServletRequestAttributes attributes = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        Request requestInfo = new Request()
                .setIp(ip)
                .setThreadName(threadName);
        if (attributes == null) {
            return requestInfo;
        }
        HttpServletRequest request = attributes.getRequest();
        Map<String, String> headers = new HashMap<>(16);
        Enumeration<String> headerNames = request.getHeaderNames();
        while (headerNames.hasMoreElements()) {
            String headerName = headerNames.nextElement();
            headers.put(headerName, request.getHeader(headerName));
        }

        return requestInfo.setMethod(request.getMethod())
                .setUrl(request.getRequestURL().toString())
                .setHeaders(headers);
    }

    private void renderAndPrintLog(
            Log logAnnotation,
            Request request,
            Object result,
            MethodInvocation invocation,
            long time
    ) {
        StringBuilder logs = new StringBuilder();
        List<Object> args = new LinkedList<>();
        // 打印请求相关参数
        logs.append("\n========================================== Start ==========================================\n");
        /*
         * 基础信息
         */
        this.renderBaseInfo(logAnnotation.value(), invocation.getMethod(), request, logs, args);
        /*
         * 请求头信息
         */
        this.renderRequestHeaders(logAnnotation.headers(), request.getHeaders(), logs, args);

        /*
         * 请求参数
         */
        this.renderRequestParam(invocation.getArguments(), logs, args);
        /*
         * 返回值
         */
        this.renderResponse(result, logs, args);
        /*
         *执行时间
         */
        logs.append("Time-Consuming : {} ms\n");
        args.add(time);
        logs.append("=========================================== End ===========================================\n");

        this.printLog(logAnnotation, logs.toString(), args.toArray());
    }

    private Log getLogAnnotation(Method method) {
        Log annotation = AnnotationUtils.findAnnotation(method, Log.class);
        if (annotation != null) {
            return annotation;
        }
        return AnnotationUtils.findAnnotation(method.getDeclaringClass(), Log.class);
    }

    /**
     * 判断是否需要打印
     */
    private boolean isLogEnable(LogLevel level) {
        return switch (level) {
            case TRACE -> log.isTraceEnabled();
            case DEBUG -> log.isDebugEnabled();
            case INFO -> log.isInfoEnabled();
            case WARN -> log.isWarnEnabled();
            case ERROR -> log.isErrorEnabled();
            default -> false;
        };
    }


    private void printLog(Log logAnnotation, String logStr, Object... args) {
        switch (logAnnotation.level()) {
            case TRACE -> LogInterceptor.log.trace(logStr, args);
            case DEBUG -> LogInterceptor.log.debug(logStr, args);
            case INFO -> LogInterceptor.log.info(logStr, args);
            case WARN -> LogInterceptor.log.warn(logStr, args);
            case ERROR -> LogInterceptor.log.error(logStr, args);
            default -> {
            }
        }
    }

    /**
     * 渲染基础参数
     */
    private void renderBaseInfo(String description, Method method, Request request, StringBuilder logs, List<Object> args) {
        //线程id
        logs.append("ThreadName     : {} \n");
        args.add(request.getThreadName());

        if (StrUtil.isNotEmpty(description)) {
            logs.append("Description    : {} \n");
            args.add(description);
        }
        // 打印请求 url
        if (StrUtil.isNotEmpty(request.getMethod())) {
            logs.append("URL            : [{}]{}\n");
            args.add(request.getMethod());
            args.add(request.getUrl());
        }
        // 打印调用 controller 的全路径以及执行方法
        logs.append("Class Method   : {}.{}\n");
        args.add(method.getDeclaringClass().getName());
        args.add(method.getName());
        /*
         * 客户端ip
         */
        String ip = request.getIp();
        if (StrUtil.isNotEmpty(ip)) {
            logs.append("IP             : {}\n");
            args.add(ip);
        }
    }

    /**
     * 渲染请求参数
     */
    private void renderRequestParam(Object[] arguments, StringBuilder logs, List<Object> args) {
        if (ArrayUtil.isEmpty(arguments)) {
            return;
        }
        logs.append("Request Args   : (");
        for (Object arg : arguments) {
            if ((arg instanceof ServletResponse) || (arg instanceof ServletRequest)) {
                continue;
            }
            logs.append("{}").append(",");
            args.add(arg);
        }
        logs.deleteCharAt(logs.length() - 1);
        logs.append(")\n");
    }

    /**
     * 渲染请求头参数
     */
    private void renderRequestHeaders(String[] annotationHeaders, Map<String, String> headers, StringBuilder logs, List<Object> args) {
        Set<String> configHeaders = new HashSet<>(properties.getHeaderNames());
        configHeaders.addAll(Arrays.asList(annotationHeaders));
        configHeaders.forEach(
                configHeader -> {
                    String value = headers.get(configHeader);
                    logs.append("Header         : {}: {}\n");
                    args.add(configHeader);
                    args.add(value);
                }
        );
    }

    /**
     * 渲染返回值
     */
    private void renderResponse(Object response, StringBuilder logs, List<Object> args) {
        logs.append("Response Args  : {}\n");
        args.add(response == null ? "null" : response == void.class ? "void" : response);
    }


    @Getter
    @Setter
    @Accessors(chain = true)
    private static class Request {
        private String ip;
        private String threadName;
        private String method;
        private String url;
        private Map<String, String> headers;
    }
}
