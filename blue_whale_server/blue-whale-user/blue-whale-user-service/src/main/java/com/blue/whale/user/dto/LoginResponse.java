package com.blue.whale.user.dto;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class LoginResponse {

    /** accessToken（15分钟） */
    private String accessToken;

    /** refreshToken（30天） */
    private String refreshToken;

    /** accessToken 有效期（秒） */
    private Long expiresIn;

    private Long userId;

    private String username;
    private String phone;

    /** 头像 URL；空或 "0" 表示默认首字头像 */
    private String avatar;

    private Boolean isNewUser;

    /** 是否已设置密码 */
    private Boolean hasPassword;
}
