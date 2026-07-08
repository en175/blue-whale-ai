package com.blue.whale.user.dto;

import lombok.Builder;
import lombok.Data;

/**
 * 用户信息响应
 */
@Data
@Builder
public class UserInfoResponse {

    private Long userId;
    private String username;
    private String phone;
}
