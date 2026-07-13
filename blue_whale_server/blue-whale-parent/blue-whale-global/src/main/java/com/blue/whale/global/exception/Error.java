package com.blue.whale.global.exception;

import java.io.Serializable;

/**
 * Error
 *
 * @author: Jiyeon2__
 * date: 2024/8/14
 * description: 全局错误异常抽象类
 */
public interface Error extends Serializable {
    /**
     * 错误代码
     *
     * @return 错误代码
     */
    int code();

    /**
     * 错误提示
     *
     * @return 错误提示
     */
    String msg();

    /**
     * 返回的异常数据
     *
     * @return 异常数据
     */
    default Object data() {
        return null;
    }

    /**
     * exception msg with arguments
     *
     * @param args 参数
     * @return 错误提示
     */
    default String msg(Object... args) {
        return msg();
    }

    /**
     * 获取异常
     *
     * @return 渲染异常
     */
    default GlobalException exception() {
        return new GlobalException(code(), msg());
    }

    /**
     * 获取异常
     *
     * @param args 模板参数
     * @return 渲染异常
     */
    default GlobalException exception(Object... args) {
        return new GlobalException(code(), msg(args));
    }

    /**
     * 条件为false抛出异常
     *
     * @param success 条件
     */
    default void falseThrow(boolean success) {
        if (success) {
            return;
        }
        throw this.exception();
    }

    /**
     * 条件为true抛出异常
     *
     * @param success 条件
     */
    default void trueThrow(boolean success) {
        if (success) {
            throw this.exception();
        }
    }

    /**
     * 指定使用消息
     *
     * @param msg 替换的消息
     * @return 渲染异常
     */
    default GlobalException msgEx(String msg) {
        return new GlobalException(code(), msg);
    }

    /**
     * 获取异常
     *
     * @param data 异常提示数据
     * @return 渲染异常
     */
    default GlobalException dataEx(Object data) {
        GlobalException globalException = new GlobalException(msg());
        globalException.setCode(code());
        globalException.setData(data);
        return globalException;
    }


    /**
     * 获取异常
     *
     * @param data 异常提示数据
     * @param args 模板参数
     * @return 渲染异常
     */
    default GlobalException dataEx(Object data, Object... args) {
        GlobalException globalException = new GlobalException(msg(args));
        globalException.setCode(code());
        globalException.setData(data);
        return globalException;
    }
}
