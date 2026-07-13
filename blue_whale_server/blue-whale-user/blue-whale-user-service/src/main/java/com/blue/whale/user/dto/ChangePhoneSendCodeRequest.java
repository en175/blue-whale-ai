package com.blue.whale.user.dto;

import com.alibaba.fastjson2.annotation.JSONField;
import lombok.Data;

import javax.validation.constraints.NotBlank;

@Data
public class ChangePhoneSendCodeRequest {

    @NotBlank(message = "新手机号不能为空")
    @JSONField(name = "new_phone")
    private String newPhone;

    @NotBlank(message = "图形验证码 token 不能为空")
    @JSONField(name = "captcha_token")
    private String captchaToken;

    @NotBlank(message = "图形验证码答案不能为空")
    @JSONField(name = "captcha_answer")
    private String captchaAnswer;
}
