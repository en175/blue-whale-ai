package com.blue.whale.user.dto;

import com.alibaba.fastjson2.annotation.JSONField;
import lombok.Builder;
import lombok.Data;

/**
 * 用户信息响应
 */
@Data
@Builder
public class UserInfoResponse {

    @JSONField(name = "user_id")
    private Long userId;

    private String username;
    private String phone;

    @JSONField(name = "has_password")
    private Boolean hasPassword;
}
