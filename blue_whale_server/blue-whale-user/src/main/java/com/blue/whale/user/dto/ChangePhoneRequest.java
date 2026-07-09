package com.blue.whale.user.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;

/**
 * 换绑手机号——验证码校验请求
 */
@Data
public class ChangePhoneRequest {

    @NotBlank(message = "新手机号不能为空")
    private String newPhone;

    @NotBlank(message = "验证码不能为空")
    private String code;
}
