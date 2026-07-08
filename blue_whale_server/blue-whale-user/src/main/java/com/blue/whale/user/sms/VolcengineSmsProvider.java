package com.blue.whale.user.sms;

import lombok.extern.slf4j.Slf4j;

/**
 * 火山引擎短信发送（占位实现）
 */
@Slf4j
public class VolcengineSmsProvider implements SmsProvider {

    public VolcengineSmsProvider() {
        log.info("VolcengineSmsProvider 已注册（占位实现，待接入火山引擎SDK）");
    }

    @Override
    public void send(String phone, String code) {
        // TODO: 接入火山引擎短信 SDK
        // VolcengineSms.send(phone, templateId, Map.of("code", code));
        log.info("[火山引擎] 发送短信到 {}, 验证码: {}", phone, code);
    }
}
