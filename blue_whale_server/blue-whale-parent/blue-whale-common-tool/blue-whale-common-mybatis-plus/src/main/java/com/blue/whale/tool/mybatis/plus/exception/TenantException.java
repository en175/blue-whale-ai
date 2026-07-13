package com.blue.whale.tool.mybatis.plus.exception;

import com.blue.whale.global.exception.GlobalException;

public class TenantException extends GlobalException {

    public TenantException(int code, String message) {
        super(code, message);
    }

    public TenantException(String message) {
        super(message);
    }

    public TenantException(int code, String message, Throwable cause) {
        super(code, message, cause);
    }

    public TenantException(String message, Throwable cause) {
        super(message, cause);
    }
}
