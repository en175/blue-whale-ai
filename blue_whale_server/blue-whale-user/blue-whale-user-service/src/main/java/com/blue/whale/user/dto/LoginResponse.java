package com.blue.whale.user.dto;

import com.alibaba.fastjson2.annotation.JSONField;
import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class LoginResponse {

    /** access_token（15分钟） */
    @JSONField(name = "access_token")
    private String accessToken;

    /** refresh_token（30天） */
    @JSONField(name = "refresh_token")
    private String refreshToken;

    /** access_token 有效期（秒） */
    @JSONField(name = "expires_in")
    private Long expiresIn;

    @JSONField(name = "user_id")
    private Long userId;

    private String username;
    private String phone;

    @JSONField(name = "is_new_user")
    private Boolean isNewUser;

    /** 是否已设置密码（null=未设） */
    @JSONField(name = "has_password")
    private Boolean hasPassword;
}
