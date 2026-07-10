package com.blue.whale.global.base.resp;

import com.blue.whale.global.exception.Error;

/**
 * IResultCode
 *
 * @author: Jiyeon2__
 * date: 2024/8/14
 * description: 状态码接口
 */
public interface IResultCode extends Error {
    /**
     * 返回的code码
     *
     * @return code
     */
    int getCode();

    /**
     * 返回的消息
     *
     * @return 消息
     */
    String getMsg();

    /**
     * 错误代码
     *
     * @return 错误代码
     */
    @Override
    default int code() {
        return getCode();
    }

    /**
     * 错误消息key
     *
     * @return 错误消息key
     */
    @Override
    default String msg() {
        return getMsg();
    }
}
