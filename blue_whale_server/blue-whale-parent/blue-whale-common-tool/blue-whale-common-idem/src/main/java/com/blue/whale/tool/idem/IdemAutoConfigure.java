package com.blue.whale.tool.idem;

import com.blue.whale.tool.idem.aspect.IdemAdvisor;
import com.blue.whale.tool.idem.aspect.IdemInterceptor;
import com.blue.whale.tool.idem.helper.IdemHelper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.context.annotation.Import;

/**
 * IdemAutoConfigure
 *
 * @author: Jiyeon2__
 * date: 2024/8/19
 * description:
 * 幂等性校验工具自动装配
 * 增加幂等响应头 IDEM
 */
@Import({IdemAdvisor.class, IdemInterceptor.class, IdemHelper.class})
@ConditionalOnClass(name = {"org.springframework.data.redis.core.RedisTemplate", "org.springframework.aop.support.annotation.AnnotationMatchingPointcut"})
public class IdemAutoConfigure {
}
