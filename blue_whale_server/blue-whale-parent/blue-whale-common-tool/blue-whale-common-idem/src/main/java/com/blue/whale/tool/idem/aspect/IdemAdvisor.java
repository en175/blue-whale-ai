package com.blue.whale.tool.idem.aspect;


import com.blue.whale.global.constants.AspectOrder;
import com.blue.whale.tool.idem.annotation.Idem;
import org.aopalliance.aop.Advice;
import org.springframework.aop.Pointcut;
import org.springframework.aop.support.AbstractPointcutAdvisor;
import org.springframework.aop.support.annotation.AnnotationMatchingPointcut;
import org.springframework.lang.NonNull;

/**
 * IdemAdvisor
 *
 * @author: Jiyeon2__
 * date: 2025/4/1
 * description: 幂等切面
 */
public class IdemAdvisor extends AbstractPointcutAdvisor {
    /**
     * 方法增强
     */
    private final Advice advice;
    /**
     * 切点
     */
    private final Pointcut pointcut;

    public IdemAdvisor(IdemInterceptor advice) {
        this.advice = advice;
        this.pointcut = AnnotationMatchingPointcut.forMethodAnnotation(Idem.class);
        super.setOrder(AspectOrder.IDEM_ASPECT);
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
