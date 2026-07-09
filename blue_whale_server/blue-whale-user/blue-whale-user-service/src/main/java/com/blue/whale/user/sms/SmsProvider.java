package com.blue.whale.user.sms;

/**
 * 短信发送接口
 */
public interface SmsProvider {

    /**
     * 发送短信验证码
     *
     * @param phone 手机号
     * @param code  验证码
     */
    void send(String phone, String code);
}
