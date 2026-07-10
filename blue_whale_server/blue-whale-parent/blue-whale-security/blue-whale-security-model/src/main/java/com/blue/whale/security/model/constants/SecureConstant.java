package com.blue.whale.security.model.constants;


/**
 * SecureConstant
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: 安全框架常量
 */
public interface SecureConstant {
    /**
     * 默认的用具昵称前缀
     */
    String DEFAULT_USER_NICKNAME_PREFIX = "WT";

    /**
     * 用户登录检查 最后一个参数为公司id
     */
    String USER_LOGIN_STATE_CHECK = "sweet:oa:uaa:login:user";
}
