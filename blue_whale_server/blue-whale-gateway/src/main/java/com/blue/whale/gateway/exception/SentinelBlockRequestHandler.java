package com.blue.whale.gateway.exception;

import com.alibaba.csp.sentinel.adapter.gateway.sc.callback.BlockRequestHandler;
import com.alibaba.csp.sentinel.slots.block.authority.AuthorityException;
import com.alibaba.csp.sentinel.slots.block.degrade.DegradeException;
import com.alibaba.csp.sentinel.slots.block.flow.FlowException;
import com.alibaba.csp.sentinel.slots.block.flow.param.ParamFlowException;
import com.alibaba.csp.sentinel.slots.system.SystemBlockException;
import com.blue.whale.global.base.resp.Result;
import com.blue.whale.global.base.resp.SystemCode;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.server.ServerResponse;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * SentinelBlockRequestHandler
 *
 * @author: Jiyeon2__
 * date: 2024/9/27
 * description: Sentinel异常处理
 */
public class SentinelBlockRequestHandler implements BlockRequestHandler {

    @Override
    public Mono<ServerResponse> handleRequest(ServerWebExchange serverWebExchange, Throwable throwable) {

        Result result = Result.failed(SystemCode.SYSTEM_BUSY.getCode(), SystemCode.SYSTEM_BUSY.getMsg());

        if(throwable instanceof FlowException){
            result = Result.failed(SystemCode.SENTINEL_FLOW_BLOCK.getCode(), SystemCode.SENTINEL_FLOW_BLOCK.getMsg());
        }

        if(throwable instanceof DegradeException){
            result =  Result.failed(SystemCode.SENTINEL_DEGRADE_BLOCK.getCode(), SystemCode.SENTINEL_DEGRADE_BLOCK.getMsg());
        }

        if(throwable instanceof ParamFlowException){
            result = Result.failed(SystemCode.SENTINEL_PARAM_FLOW_BLOCK.getCode(), SystemCode.SENTINEL_PARAM_FLOW_BLOCK.getMsg());
        }

        if(throwable instanceof SystemBlockException){
           result = Result.failed(SystemCode.SENTINEL_SYSTEM_BLOCK.getCode(), SystemCode.SENTINEL_SYSTEM_BLOCK.getMsg());
        }

        if(throwable instanceof AuthorityException){
            result = Result.failed(SystemCode.SENTINEL_AUTHORITY_BLOCK.getCode(), SystemCode.SENTINEL_AUTHORITY_BLOCK.getMsg());
        }

        return ServerResponse.status(HttpStatus.TOO_MANY_REQUESTS)
                .contentType(MediaType.APPLICATION_JSON)
                .body(BodyInserters.fromValue(result));
    }
}
