package com.blue.whale.user.sms;

import lombok.extern.slf4j.Slf4j;

/**
 * 开发环境短信：控制台打印验证码
 */
@Slf4j
public class ConsoleSmsProvider implements SmsProvider {

    @Override
    public void send(String phone, String code) {
        log.info("========== 短信验证码 ==========");
        log.info("手机号: {}", maskPhone(phone));
        log.info("验证码: {}", code);
        log.info("================================");
    }

    private static String maskPhone(String phone) {
        if (phone == null || phone.length() < 7) return "***";
        return phone.substring(0, 3) + "****" + phone.substring(7);
    }
}
