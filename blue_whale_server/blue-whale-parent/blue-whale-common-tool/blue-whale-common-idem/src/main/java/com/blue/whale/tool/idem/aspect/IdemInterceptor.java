package com.blue.whale.tool.idem.aspect;


import com.blue.whale.tool.idem.annotation.Idem;
import com.blue.whale.tool.idem.exception.IdemException;
import com.blue.whale.tool.idem.exception.IdemInvalidException;
import com.blue.whale.tool.idem.helper.IdemHelper;
import com.blue.whale.tool.idem.model.IdemCode;
import com.blue.whale.web.model.ISystem;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.aopalliance.intercept.MethodInterceptor;
import org.aopalliance.intercept.MethodInvocation;
import org.springframework.core.annotation.AnnotationUtils;
import org.springframework.lang.NonNull;

/**
 * IdemInterceptor
 *
 * @author: Jiyeon2__
 * date: 2025/3/31
 * description:
 */
@Slf4j
@RequiredArgsConstructor
public class IdemInterceptor implements MethodInterceptor {

    private final IdemHelper helper;

    @Override
    public Object invoke(@NonNull MethodInvocation invocation) throws Throwable {
        log.debug("@Idem annotation aspect working...");
        /*
         * 检查设备id
         */
        String deviceId = ISystem.deviceIdOpt().getOrElseThrow(() -> new IdemInvalidException("bad request"));
        /*
         * 获取注解
         */
        Idem annotation = AnnotationUtils.findAnnotation(invocation.getMethod(), Idem.class);
        assert annotation != null;
        boolean allow = helper.isAllow(
                deviceId,
                helper.getMethodName(invocation.getMethod()),
                annotation.expire()
        );
        if (allow) {
            return invocation.proceed();
        }
        throw new IdemException(IdemCode.REPEAT_SUBMIT, "请勿重复提交");
    }

}
