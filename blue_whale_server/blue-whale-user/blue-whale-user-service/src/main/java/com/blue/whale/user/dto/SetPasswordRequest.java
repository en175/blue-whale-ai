package com.blue.whale.user.dto;

import com.alibaba.fastjson2.annotation.JSONField;
import lombok.Data;

import javax.validation.constraints.NotBlank;

/**
 * 首次设置密码请求
 */
@Data
public class SetPasswordRequest {

    @NotBlank(message = "验证码不能为空")
    private String code;

    @NotBlank(message = "新密码不能为空")
    @JSONField(name = "new_password")
    private String newPassword;
}
