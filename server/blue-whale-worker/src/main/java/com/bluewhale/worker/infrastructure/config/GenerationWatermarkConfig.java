package com.bluewhale.worker.infrastructure.config;

import com.bluewhale.worker.infrastructure.persistence.mapper.SystemSettingMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class GenerationWatermarkConfig {

    @Bean
    public GenerationWatermarkPolicy generationWatermarkPolicy(SystemSettingMapper systemSettingMapper) {
        return new GenerationWatermarkPolicy(systemSettingMapper);
    }

    public static final class GenerationWatermarkPolicy {

        public static final String SETTING_KEY = "watermark";

        public static final String FIELD_ENABLED = "enabled";

        private static final ObjectMapper JSON = new ObjectMapper();

        private static final Logger log = LoggerFactory.getLogger(GenerationWatermarkPolicy.class);

        private final SystemSettingMapper systemSettingMapper;

        public GenerationWatermarkPolicy(SystemSettingMapper systemSettingMapper) {
            this.systemSettingMapper = systemSettingMapper;
        }

        public static GenerationWatermarkPolicy disabled() {
            return new GenerationWatermarkPolicy(key -> null);
        }

        public boolean enabled() {
            String raw;
            try {
                raw = systemSettingMapper.selectValue(SETTING_KEY);
            } catch (Exception e) {
                log.warn("读取 system_settings.watermark 失败，按关闭处理: {}", e.getMessage());
                return false;
            }
            if (raw == null || raw.isBlank()) return false;
            try {
                JsonNode node = JSON.readTree(raw);
                JsonNode value = node.get(FIELD_ENABLED);
                return value != null && value.isBoolean() && value.asBoolean();
            } catch (Exception e) {
                log.warn("system_settings.watermark 不是合法 JSON，按关闭处理: {}", e.getMessage());
                return false;
            }
        }
    }
}
