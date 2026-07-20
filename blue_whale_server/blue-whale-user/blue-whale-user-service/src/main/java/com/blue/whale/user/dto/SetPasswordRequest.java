package com.blue.whale.user.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/**
 * 设置密码请求
 */
@Data
public class SetPasswordRequest {

    @NotBlank(message = "验证码不能为空")
    private String code;

    @NotBlank(message = "密码不能为空")
    @Size(min = 8, max = 128, message = "密码长度 8-128 位")
    private String password;
}
