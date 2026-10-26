package com.bluewhale.worker.infrastructure.config;

import com.bluewhale.common.http.NewApiHttpSupport;
import com.bluewhale.worker.infrastructure.persistence.mapper.SystemSettingMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

@Configuration
public class NewApiUpstreamConfig {

    private static final Logger log = LoggerFactory.getLogger(NewApiUpstreamConfig.class);

    public static final String ENV_BASE_URL = "NEW_API_BASE_URL";

    @Bean
    public UpstreamBaseUrl newApiBaseUrl(Environment env) {
        return new UpstreamBaseUrl(env.getProperty(ENV_BASE_URL));
    }

    @Bean
    public UpstreamCredential newApiUpstreamCredential(
            SystemSettingMapper systemSettingMapper, Environment env) {
        String secret = env.getProperty(SystemSettingEnvelope.SECRET_ENV);
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException(
                    SystemSettingEnvelope.SECRET_ENV + " 未配置：读不出 system_settings 里的上游凭证"
                            + "（主密钥必须与数据库分开存放；缺它时拒读，不降级成明文）");
        }
        return new UpstreamCredential(systemSettingMapper, secret.trim());
    }

    public static int timeoutMs(String envName, int defaultMs) {
        String raw = System.getenv(envName);
        if (raw != null) {
            try {
                int n = Integer.parseInt(raw);
                if (n > 0) return n;
            } catch (NumberFormatException e) {
                log.debug("{} 解析失败，使用默认值: {}", envName, e.getMessage());
            }
        }
        return defaultMs;
    }

    public record UpstreamBaseUrl(String value) {

        public UpstreamBaseUrl {
            if (value == null || value.isBlank()) {
                throw new IllegalStateException(NewApiHttpSupport.BASE_URL_MISSING_MSG);
            }
        }

        public String normalized() {
            return NewApiHttpSupport.normalizeBaseUrl(value);
        }
    }

    public static final class UpstreamCredential {

        public static final String SETTING_KEY = "upstream";

        public static final String FIELD_NEW_API_KEY = "new_api_key";

        private static final ObjectMapper JSON = new ObjectMapper();

        private final SystemSettingMapper systemSettingMapper;
        private final String secret;

        public UpstreamCredential(SystemSettingMapper systemSettingMapper, String secret) {
            this.systemSettingMapper = systemSettingMapper;
            this.secret = secret;
        }

        public String requireKey() {
            String envelope = systemSettingMapper.selectValue(SETTING_KEY);
            if (envelope == null || envelope.isBlank()) {
                throw new IllegalStateException(
                        "上游凭证未配置：请在管理端「系统设置 → 上游凭证」填入 new-api 的项目统一 key");
            }
            String json = SystemSettingEnvelope.open(envelope, secret);
            String key;
            try {
                key = JSON.readTree(json).path(FIELD_NEW_API_KEY).asText("");
            } catch (Exception e) {
                throw new IllegalStateException(
                        "上游凭证不是合法的 JSON 对象，请人工核对：" + e.getMessage(), e);
            }
            if (key.isBlank()) {
                throw new IllegalStateException(
                        "上游凭证为空：请在管理端「系统设置 → 上游凭证」填入 new-api 的项目统一 key");
            }
            return key.trim();
        }
    }
}
