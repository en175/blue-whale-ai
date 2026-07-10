package com.blue.whale.global.base.resp;

import com.blue.whale.global.exception.Error;
import lombok.Getter;
import lombok.Setter;
import lombok.ToString;
import lombok.experimental.Accessors;

import java.io.Serial;
import java.io.Serializable;

/**
 * Result
 *
 * @author: Jiyeon2__
 * date: 2024/8/14
 * description:
 */
@Getter
@Setter
@ToString
@Accessors(chain = true)
public class Result<T> implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;
    /**
     * 响应状态码
     */
    private int code;
    /**
     * 响应消息
     */
    private String msg;
    /**
     * 响应数据
     */
    private T data;

    private Result() {
    }

    public static <T> Result<T> ok() {
        return ok(null);
    }

    public static <T> Result<T> ok(T data) {
        return ok(data, null);
    }

    public static <T> Result<T> ok(T data, String msg) {
        return restResult(data, SystemCode.SUCCESS_CODE, msg);
    }

    public static <T> Result<T> failed() {
        return failed((String) null);
    }

    public static <T> Result<T> failed(String msg) {
        return restResult(null, SystemCode.FAILURE_CODE, msg);
    }

    public static <T> Result<T> failed(T data) {
        return restResult(data, SystemCode.FAILURE_CODE, null);
    }

    public static <T> Result<T> failed(int code, String msg) {
        return restResult(null, code, msg);
    }

    @SuppressWarnings("unchecked")
    public static <T> Result<T> failed(Error error) {
        Result<T> failed = failed(error.code(), error.msg());
        failed.setData((T) error.data());
        return failed;
    }

    public static <T> Result<T> failed(Error error, String msg) {
        return restResult(null, error.code(), msg);
    }

    private static <T> Result<T> restResult(T data, int code, String msg) {
        return new Result<T>()
                .setCode(code)
                .setData(data)
                .setMsg(msg);
    }

    /**
     * 判断是否成功
     *
     * @author 张治保
     * 2021年12月8日
     */
    public boolean isSuccess() {
        return SystemCode.SUCCESS_CODE == this.code;
    }

}
