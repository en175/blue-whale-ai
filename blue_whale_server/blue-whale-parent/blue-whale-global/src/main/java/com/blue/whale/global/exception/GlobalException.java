package com.blue.whale.global.exception;

import lombok.Getter;
import lombok.Setter;

/**
 * GlobalException
 *
 * @author: Jiyeon2__
 * date: 2024/8/14
 * description:
 */
@Getter
@Setter
public class GlobalException extends RuntimeException implements Error {


    /**
     * 自定义状态码
     */
    private int code;

    /**
     * 异常数据提示
     */
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


    public GlobalException(String message, Throwable cause) {
        super(message, cause);
        this.code = 500;
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
