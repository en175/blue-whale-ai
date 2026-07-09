package com.bluewhale.agent.common.exception;

import java.io.Serializable;

/**
 * 全局错误/异常断言接口。借鉴 sweet-oa-global，裁剪后保留核心断言能力。
 *
 * <p>业务侧用法：{@code SystemCode.DATA_UPDATE_FAILED.falseThrow(ok);} —— 失败即抛 {@link GlobalException}。
 */
public interface Error extends Serializable {

    /** 错误码。 */
    int code();

    /** 错误提示。 */
    String msg();

    /** 随异常返回的数据，默认空。 */
    default Object data() {
        return null;
    }

    /** 渲染异常（默认无模板参数）。 */
    default GlobalException exception() {
        return new GlobalException(code(), msg());
    }

    /** 条件为 false 时抛异常。 */
    default void falseThrow(boolean success) {
        if (!success) {
            throw this.exception();
        }
    }

    /** 条件为 true 时抛异常。 */
    default void trueThrow(boolean success) {
        if (success) {
            throw this.exception();
        }
    }

    /** 指定替换消息渲染异常。 */
    default GlobalException msgEx(String msg) {
        return new GlobalException(code(), msg);
    }

    /** 携带数据渲染异常。 */
    default GlobalException dataEx(Object data) {
        GlobalException e = new GlobalException(msg());
        e.setCode(code());
        e.setData(data);
        return e;
    }
}
