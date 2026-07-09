package com.blue.whale.user.dto;

import com.alibaba.fastjson2.annotation.JSONField;
import lombok.Builder;
import lombok.Data;

/**
 * 登录响应
 */
@Data
@Builder
public class LoginResponse {

    /** JWT token */
    private String token;

    /** 用户ID */
    @JSONField(name = "user_id")
    private Long userId;

    /** 用户名 */
    private String username;

    /** 手机号 */
    private String phone;

    /** 是否新注册 */
    @JSONField(name = "is_new_user")
    private Boolean isNewUser;
}
