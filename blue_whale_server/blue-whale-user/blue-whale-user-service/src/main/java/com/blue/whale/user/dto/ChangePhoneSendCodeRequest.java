package com.blue.whale.user.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;

@Data
public class ChangePhoneSendCodeRequest {

    @NotBlank(message = "新手机号不能为空")
    private String newPhone;
}
