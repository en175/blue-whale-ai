package com.blue.whale.user.dto;

import com.alibaba.fastjson2.annotation.JSONField;
import lombok.Data;

import javax.validation.constraints.NotBlank;

/**
 * 发送验证码请求
 */
@Data
public class SendCodeRequest {

    @NotBlank(message = "手机号不能为空")
    private String phone;

    @NotBlank(message = "图形验证码 token 不能为空")
    @JSONField(name = "captcha_token")
    private String captchaToken;

    @NotBlank(message = "图形验证码答案不能为空")
    @JSONField(name = "captcha_answer")
    private String captchaAnswer;
}
