package com.blue.whale.user.sms;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import lombok.extern.slf4j.Slf4j;

import java.nio.charset.StandardCharsets;
import java.util.Date;

/**
 * 火山引擎短信发送
 */
@Slf4j
public class VolcengineSmsProvider implements SmsProvider {

    private final VolcengineProperties.Sms config;

    public VolcengineSmsProvider(VolcengineProperties.Sms config) {
        this.config = config;
    }

    @Override
    public void send(String phone, String code) {
        try {
            VolcengineSigner signer = new VolcengineSigner(
                    "cn-beijing",
                    "volcSMS",
                    "https",
                    "open.volcengineapi.com",
                    "/",
                    config.getAccessKeyId(),
                    config.getSecretAccessKey()
            );

            // 模板参数
            String templateParam = "{\"code\":\"" + code + "\"}";

            // 构造 JSON body
            String jsonBody = "{" +
                    "\"SmsAccount\":\"" + escapeJson(config.getSmsAccount()) + "\"," +
                    "\"Sign\":\"" + escapeJson(config.getSign()) + "\"," +
                    "\"TemplateID\":\"" + escapeJson(config.getTemplateId()) + "\"," +
                    "\"TemplateParam\":\"" + escapeJson(templateParam) + "\"," +
                    "\"PhoneNumbers\":\"" + phone + "\"," +
                    "\"Tag\":\"blue-whale-user\"" +
                    "}";

            String response = signer.doRequest(
                    "POST",
                    jsonBody.getBytes(StandardCharsets.UTF_8),
                    new Date(),
                    "SendSms",
                    "2020-01-01"
            );

            // 判断结果
            JSONObject resp = JSON.parseObject(response);
            if (resp.containsKey("ResponseMetadata")) {
                JSONObject meta = resp.getJSONObject("ResponseMetadata");
                if (meta.containsKey("Error")) {
                    JSONObject error = meta.getJSONObject("Error");
                    String errMsg = error.getString("Code") + ": " + error.getString("Message");
                    log.error("火山短信发送失败: {}", errMsg);
                    throw new RuntimeException("短信发送失败: " + errMsg);
                } else {
                    log.info("火山短信发送成功: phone={}, code={}, response={}",
                            maskPhone(phone), code, response);
                }
            }
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            log.error("火山短信调用异常: phone={}", maskPhone(phone), e);
            throw new RuntimeException("短信服务异常", e);
        }
    }

    private String escapeJson(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private String maskPhone(String phone) {
        if (phone == null || phone.length() < 7) return "***";
        return phone.substring(0, 3) + "****" + phone.substring(7);
    }
}
