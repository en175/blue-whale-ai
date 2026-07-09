package com.blue.whale.user.dto;

import com.alibaba.fastjson2.annotation.JSONField;
import lombok.Data;

import javax.validation.constraints.NotBlank;

@Data
public class ChangePhoneRequest {

    @NotBlank(message = "新手机号不能为空")
    @JSONField(name = "new_phone")
    private String newPhone;

    @NotBlank(message = "验证码不能为空")
    private String code;
}
