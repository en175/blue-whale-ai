package com.blue.whale.user.sms;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * 火山引擎配置
 */
@Data
@Configuration
@ConfigurationProperties(prefix = "volcengine")
public class VolcengineProperties {

    /** 短信配置 */
    private Sms sms = new Sms();

    @Data
    public static class Sms {
        /** Access Key ID */
        private String accessKeyId;
        /** Secret Access Key */
        private String secretAccessKey;
        /** 消息组 ID */
        private String smsAccount;
        /** 短信签名 */
        private String sign;
        /** 模板 ID (ST_xxx) */
        private String templateId;
    }
}
