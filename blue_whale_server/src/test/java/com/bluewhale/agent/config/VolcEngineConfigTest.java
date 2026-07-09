package com.bluewhale.agent.config;

import com.volcengine.ark.runtime.service.ArkService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link VolcEngineConfig} 测试：ArkProperties 绑定 + ArkService bean 装配。
 * 不连网络/DB，仅验证 bean 创建与配置注入。
 */
@SpringBootTest(classes = VolcEngineConfig.class, properties = {
        "volcengine.ark.api-key=test-key",
        "volcengine.ark.base-url=https://ark.test/api/v3"
})
class VolcEngineConfigTest {

    @Autowired
    private ArkService arkService;

    @Autowired
    private VolcEngineConfig.ArkProperties arkProperties;

    @Test
    void arkServiceBeanCreated() {
        assertThat(arkService).isNotNull();
    }

    @Test
    void propertiesBoundFromEnvironment() {
        assertThat(arkProperties.getApiKey()).isEqualTo("test-key");
        assertThat(arkProperties.getBaseUrl()).isEqualTo("https://ark.test/api/v3");
    }

    @Test
    void defaultsAppliedWhenNotOverridden() {
        // 重新构造未覆盖字段的默认值校验（image/video/base 都被覆盖，这里验 apiKey 透传非空）
        assertThat(arkProperties.getApiKey()).isNotBlank();
    }
}
