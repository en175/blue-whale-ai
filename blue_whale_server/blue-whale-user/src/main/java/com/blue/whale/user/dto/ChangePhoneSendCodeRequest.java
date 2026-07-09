package com.blue.whale.user.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;

/**
 * 换绑手机号——发验证码请求
 */
@Data
public class ChangePhoneSendCodeRequest {

    @NotBlank(message = "新手机号不能为空")
    private String newPhone;

    @NotBlank(message = "图形验证码 token 不能为空")
    private String captchaToken;

    @NotBlank(message = "图形验证码答案不能为空")
    private String captchaAnswer;
}
