package com.blue.whale.tool.idem.exception;

/**
 * IdemInvalidException
 *
 * @author: Jiyeon2__
 * date: 2025/03/31
 * description: 幂等不可用异常
 */
public class IdemInvalidException extends RuntimeException {
    public IdemInvalidException(String message) {
        super(message);
    }
}
