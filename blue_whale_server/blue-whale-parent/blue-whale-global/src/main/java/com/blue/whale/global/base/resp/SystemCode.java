package com.blue.whale.global.base.resp;

import lombok.AllArgsConstructor;

/**
 * 系统内置错误码枚举。借鉴 sweet-oa-global，去掉 Sentinel 限流段，msg 直接内联中文（不引入 i18n 文件）。
 *
 * <p>枚举常量用 {@code SystemCode.XXX_CODE} 限定名引用后文定义的常量，规避枚举构造期前向引用。
 */
@AllArgsConstructor
public enum SystemCode implements IResultCode {

    /** 系统未知异常 */
    FAILURE(SystemCode.FAILURE_CODE, "系统未知异常"),
    /** 缺少必要的请求参数 */
    PARAM_MISS(SystemCode.PARAM_MISS_CODE, "缺少必要的请求参数"),
    /** 请求参数类型错误 */
    PARAM_TYPE_ERROR(SystemCode.PARAM_TYPE_ERROR_CODE, "请求参数类型错误"),
    /** 请求参数绑定错误 */
    PARAM_BIND_ERROR(SystemCode.PARAM_BIND_ERROR_CODE, "请求参数绑定错误"),
    /** 参数校验失败 */
    PARAM_VALID_ERROR(SystemCode.PARAM_VALID_ERROR_CODE, "参数校验失败"),
    /** 请求未找到 */
    NOT_FOUND(SystemCode.NOT_FOUND_CODE, "请求未找到"),
    /** 请求消息不可读 */
    MSG_NOT_READABLE(SystemCode.MSG_NOT_READABLE_CODE, "请求消息不可读"),
    /** 系统繁忙 */
    SYSTEM_BUSY(SystemCode.SYSTEM_BUSY_CODE, "系统繁忙"),

    /** 数据不存在 */
    DATA_NOT_EXIST(SystemCode.DATA_NOT_EXIST_CODE, "数据不存在"),
    /** 数据已存在 */
    DATA_EXISTED(SystemCode.DATA_EXISTED_CODE, "数据已存在"),
    /** 数据添加失败 */
    DATA_ADD_FAILED(SystemCode.DATA_ADD_FAILED_CODE, "数据添加失败"),
    /** 数据更新失败 */
    DATA_UPDATE_FAILED(SystemCode.DATA_UPDATE_FAILED_CODE, "数据更新失败"),
    /** 数据删除失败 */
    DATA_DELETE_FAILED(SystemCode.DATA_DELETE_FAILED_CODE, "数据删除失败"),
    /** 无权限操作数据 */
    DATA_NO_PERMISSION_OPERATE(SystemCode.DATA_NO_PERMISSION_OPERATE_CODE, "无权限操作数据"),
    /** 上游处理超时 */
    UPSTREAM_TIMEOUT(SystemCode.UPSTREAM_TIMEOUT_CODE, "上游处理超时"),
    /** 内容审核未通过 */
    CONTENT_MODERATION_REJECTED(SystemCode.CONTENT_MODERATION_REJECTED_CODE, "内容审核未通过"),
    /** 资源不可用 */
    ASSET_UNAVAILABLE(SystemCode.ASSET_UNAVAILABLE_CODE, "资源不可用"),
    ;

    /** 通用 code */
    public static final int SUCCESS_CODE = 200;
    public static final int FAILURE_CODE = 400;
    public static final int UNAUTHORIZED_CODE = 401;
    public static final int PARAM_MISS_CODE = 100000;
    public static final int PARAM_TYPE_ERROR_CODE = 100001;
    public static final int PARAM_BIND_ERROR_CODE = 100002;
    public static final int PARAM_VALID_ERROR_CODE = 100003;
    public static final int NOT_FOUND_CODE = 100004;
    public static final int MSG_NOT_READABLE_CODE = 100005;
    public static final int SYSTEM_BUSY_CODE = 100010;

    /** 数据层 code */
    public static final int DATA_NOT_EXIST_CODE = 100100;
    public static final int DATA_EXISTED_CODE = 100101;
    public static final int DATA_ADD_FAILED_CODE = 100102;
    public static final int DATA_UPDATE_FAILED_CODE = 100103;
    public static final int DATA_DELETE_FAILED_CODE = 100104;
    public static final int DATA_NO_PERMISSION_OPERATE_CODE = 100105;

    /** 上游/资源 code */
    public static final int UPSTREAM_TIMEOUT_CODE = 100200;
    public static final int CONTENT_MODERATION_REJECTED_CODE = 100201;
    public static final int ASSET_UNAVAILABLE_CODE = 100202;

    final int code;
    final String msg;

    @Override
    public int getCode() {
        return code;
    }

    @Override
    public String getMsg() {
        return msg;
    }
}
