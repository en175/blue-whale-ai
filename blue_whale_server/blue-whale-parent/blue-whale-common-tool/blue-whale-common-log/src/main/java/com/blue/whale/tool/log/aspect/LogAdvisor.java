package com.blue.whale.tool.log.aspect;


import com.blue.whale.global.constants.AspectOrder;
import com.blue.whale.tool.log.annotation.Log;
import org.aopalliance.aop.Advice;
import org.springframework.aop.Pointcut;
import org.springframework.aop.support.AbstractPointcutAdvisor;
import org.springframework.aop.support.annotation.AnnotationMatchingPointcut;
import org.springframework.lang.NonNull;

/**
 * LogAdvisor
 *
 * @author: Jiyeon2__
 * date: 2025/3/26
 * description: 日志切面
 */
public class LogAdvisor extends AbstractPointcutAdvisor {

    /**
     * 方法增强
     */
    private final Advice advice;
    /**
     * 切点
     */
    private final Pointcut pointcut;

    public LogAdvisor(LogInterceptor logInterceptor) {
        this.advice = logInterceptor;
        this.pointcut = AnnotationMatchingPointcut.forMethodAnnotation(Log.class);
        super.setOrder(AspectOrder.LOG_ASPECT);
    }

    @Override
    @NonNull
    public Pointcut getPointcut() {
        return pointcut;
    }

    @Override
    @NonNull
    public Advice getAdvice() {
        return advice;
    }
}
