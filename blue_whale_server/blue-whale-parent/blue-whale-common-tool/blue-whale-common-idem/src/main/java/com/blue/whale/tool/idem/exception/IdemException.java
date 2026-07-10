package com.blue.whale.tool.idem.exception;


import com.blue.whale.global.exception.GlobalException;

/**
 * IdemException
 *
 * @author: Jiyeon2__
 * date: 2024/8/19
 * description: 幂等校验不通过异常
 */
public class IdemException extends GlobalException {

    public IdemException(int code, String message) {
        super(code, message);
    }
}
