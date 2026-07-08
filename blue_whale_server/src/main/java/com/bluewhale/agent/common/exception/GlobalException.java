package com.bluewhale.agent.common.exception;

import lombok.Getter;
import lombok.Setter;

/**
 * 全局业务异常，携带自定义 code 与可选 data，由 {@code common.web.RestExceptionConfig} 统一捕获转 Result。
 */
@Getter
@Setter
public class GlobalException extends RuntimeException implements Error {

    /** 自定义状态码，默认 500。 */
    private int code;

    /** 异常提示数据。 */
    private Object data;

    public GlobalException() {
        super();
        this.code = 500;
    }

    public GlobalException(int code, String message) {
        super(message);
        this.code = code;
    }

    public GlobalException(String message) {
        super(message);
        this.code = 500;
    }

    public GlobalException(int code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    @Override
    public int code() {
        return code;
    }

    @Override
    public String msg() {
        return getMessage();
    }
}
