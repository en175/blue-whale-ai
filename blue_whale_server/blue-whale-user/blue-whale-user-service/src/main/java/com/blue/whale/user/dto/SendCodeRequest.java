package com.blue.whale.user.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;

/**
 * 发送验证码请求
 */
@Data
public class SendCodeRequest {

    @NotBlank(message = "手机号不能为空")
    private String phone;
}
