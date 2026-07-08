package com.bluewhale.agent.common.resp;

import com.bluewhale.agent.common.exception.Error;
import lombok.Getter;
import lombok.Setter;
import lombok.ToString;
import lombok.experimental.Accessors;

import java.io.Serial;
import java.io.Serializable;

/**
 * 统一响应封装：{@code code} / {@code msg} / {@code data}。
 */
@Getter
@Setter
@ToString
@Accessors(chain = true)
public class Result<T> implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /** 响应状态码 */
    private int code;
    /** 响应消息 */
    private String msg;
    /** 响应数据 */
    private T data;

    private Result() {
    }

    public static <T> Result<T> ok() {
        return ok(null);
    }

    public static <T> Result<T> ok(T data) {
        return restResult(data, SystemCode.SUCCESS_CODE, null);
    }

    public static <T> Result<T> failed() {
        return failed((String) null);
    }

    public static <T> Result<T> failed(String msg) {
        return restResult(null, SystemCode.FAILURE_CODE, msg);
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

    /** 是否成功。 */
    public boolean isSuccess() {
        return SystemCode.SUCCESS_CODE == this.code;
    }
}
