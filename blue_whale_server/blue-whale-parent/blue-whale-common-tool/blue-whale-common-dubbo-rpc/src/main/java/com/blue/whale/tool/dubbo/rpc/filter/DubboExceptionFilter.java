package com.blue.whale.tool.dubbo.rpc.filter;


import com.blue.whale.global.exception.GlobalException;
import lombok.extern.slf4j.Slf4j;
import org.apache.dubbo.common.constants.CommonConstants;
import org.apache.dubbo.common.extension.Activate;
import org.apache.dubbo.rpc.Invocation;
import org.apache.dubbo.rpc.Invoker;
import org.apache.dubbo.rpc.Result;
import org.apache.dubbo.rpc.filter.ExceptionFilter;

/**
 * DubboExceptionFilter
 *
 * @author: Jiyeon2__
 * date: 2025/05/13
 * description: 自定义dubbo provider异常处理
 * 参考dubbo的异常过滤器
 */
@Slf4j
@Activate(group = CommonConstants.PROVIDER)
public class DubboExceptionFilter extends ExceptionFilter {


    @Override
    public void onResponse(Result appResponse, Invoker<?> invoker, Invocation invocation) {
        if (!appResponse.hasException()) {
            return;
        }
        Throwable exception = appResponse.getException();
        super.onError(exception, invoker, invocation);
        if (exception instanceof GlobalException) {
            return;
        }
        super.onResponse(appResponse, invoker, invocation);
    }

}
