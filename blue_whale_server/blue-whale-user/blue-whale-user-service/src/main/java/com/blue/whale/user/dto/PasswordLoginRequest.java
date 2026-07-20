package com.blue.whale.user.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/**
 * 密码登录请求：account 支持手机号或用户名
 */
@Data
public class PasswordLoginRequest {

    @NotBlank(message = "手机号/用户名不能为空")
    private String account;

    @NotBlank(message = "密码不能为空")
    @Size(min = 8, max = 128, message = "密码长度 8-128 位")
    private String password;
}
