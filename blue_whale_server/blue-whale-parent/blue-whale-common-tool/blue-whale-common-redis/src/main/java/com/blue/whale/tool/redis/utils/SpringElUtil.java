package com.blue.whale.tool.redis.utils;

import cn.hutool.core.util.ArrayUtil;
import org.springframework.beans.BeansException;
import org.springframework.context.ApplicationContext;
import org.springframework.context.expression.BeanFactoryResolver;
import org.springframework.core.DefaultParameterNameDiscoverer;
import org.springframework.core.ParameterNameDiscoverer;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.expression.spel.support.StandardEvaluationContext;

import java.lang.reflect.Method;
import java.util.Map;

/**
 * SpringElUtil
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: spring el 表达式工具类
 */
public class SpringElUtil {
    /**
     * 用于解析spel表达式
     */
    private static final SpelExpressionParser PARSER = new SpelExpressionParser();
    /**
     * 用户解析参数名
     */
    private static final ParameterNameDiscoverer PARAMETER_NAME_DISCOVERER = new DefaultParameterNameDiscoverer();
    private static ApplicationContext applicationContext;

    private SpringElUtil() {
    }

    public static String[] parameterNames(Method method) {
        return PARAMETER_NAME_DISCOVERER.getParameterNames(method);
    }

    public static <T> T render(String el, Method method, Object[] args, Map<String, Object> otherParam, Class<T> clazz) {
        /*
         * 获取参数名
         */
        String[] parameterNames = parameterNames(method);
        if (ArrayUtil.isEmpty(parameterNames)) {
            throw new RuntimeException("can not get parameterNames");
        }
        /*
         *渲染参数至上下文
         */
        StandardEvaluationContext context = new StandardEvaluationContext();
        context.setBeanResolver(new BeanFactoryResolver(applicationContext));
        for (int i = 0; i < args.length; i++) {
            context.setVariable(parameterNames[i], args[i]);
        }
        if (otherParam != null) {
            context.setVariables(otherParam);

        }
        //取值
        return PARSER.parseExpression(el).getValue(context, clazz);
    }

    public static void setApplicationContext(ApplicationContext applicationContext) throws BeansException {
        SpringElUtil.applicationContext = applicationContext;
    }
}
