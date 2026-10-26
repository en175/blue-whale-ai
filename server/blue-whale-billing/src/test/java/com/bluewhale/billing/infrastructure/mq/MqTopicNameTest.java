package com.bluewhale.billing.infrastructure.mq;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class MqTopicNameTest {

    private static final Pattern ALLOWED = Pattern.compile("^[%|a-zA-Z0-9_-]+$");

    private static final String YAML = readApplicationYaml();

    private static String readApplicationYaml() {
        try (InputStream in = MqTopicNameTest.class.getResourceAsStream("/application.yml")) {
            assertThat(in).withFailMessage("读不到 application.yml").isNotNull();
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalStateException("读 application.yml 失败", e);
        }
    }

    private static String defaultValueOf(String key) {
        Matcher m = Pattern.compile("^\\s*" + Pattern.quote(key) + ":\\s*\\$\\{[^:}]+:([^}]*)}",
                Pattern.MULTILINE).matcher(YAML);
        assertThat(m.find())
                .withFailMessage("application.yml 里找不到 %s 的默认值形式 `${ENV:default}`", key)
                .isTrue();
        return m.group(1).trim();
    }

    @Test
    @DisplayName("★ topic 的默认值只含合法字符 —— 含点号会让整个服务起不来")
    void 默认topic名合法() {
        assertThat(defaultValueOf("topic-terminal")).matches(ALLOWED);
    }
}
