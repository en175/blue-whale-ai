package com.bluewhale.agent.common.resp;

import com.bluewhale.agent.common.exception.Error;

/**
 * 状态码接口：实现者提供 code 与 msg，并继承 {@link Error} 的断言能力。
 */
public interface IResultCode extends Error {

    /** 返回 code。 */
    int getCode();

    /** 返回消息。 */
    String getMsg();

    @Override
    default int code() {
        return getCode();
    }

    @Override
    default String msg() {
        return getMsg();
    }
}
