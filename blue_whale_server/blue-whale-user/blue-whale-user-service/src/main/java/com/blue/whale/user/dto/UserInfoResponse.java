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

    /** 头像 URL；空或 "0" 表示默认首字头像 */
    private String avatar;
}
