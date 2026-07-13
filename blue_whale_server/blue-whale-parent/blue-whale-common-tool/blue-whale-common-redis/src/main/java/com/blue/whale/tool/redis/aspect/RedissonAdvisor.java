package com.blue.whale.tool.redis.aspect;


import com.blue.whale.global.constants.AspectOrder;
import com.blue.whale.tool.redis.annotation.Redisson;
import org.aopalliance.aop.Advice;
import org.springframework.aop.Pointcut;
import org.springframework.aop.support.AbstractPointcutAdvisor;
import org.springframework.aop.support.annotation.AnnotationMatchingPointcut;
import org.springframework.lang.NonNull;

/**
 * RedissonAdvisor
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: redis锁切面
 */
public class RedissonAdvisor extends AbstractPointcutAdvisor {

    /**
     * 方法增强
     */
    private final Advice advice;
    /**
     * 切点
     */
    private final Pointcut pointcut;

    public RedissonAdvisor(RedissonInterceptor advice) {
        this.advice = advice;
        this.pointcut = AnnotationMatchingPointcut.forMethodAnnotation(Redisson.class);
        super.setOrder(AspectOrder.REDISSON_ASPECT);

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
