package com.blue.whale.agent.service;

import com.blue.whale.agent.config.VolcEngineConfig;
import com.blue.whale.global.exception.GlobalException;
import com.volcengine.ark.runtime.service.ArkService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class VolcEngineServiceTest {

    @Test
    @SuppressWarnings("unchecked")
    void missingArkClientFailsReadinessBeforeProviderCall() {
        ObjectProvider<ArkService> arkServiceProvider = mock(ObjectProvider.class);
        when(arkServiceProvider.getIfAvailable()).thenReturn(null);
        VolcEngineService service = new VolcEngineService(
                arkServiceProvider, new VolcEngineConfig.ArkProperties());

        assertThatThrownBy(service::requireReady)
                .isInstanceOf(GlobalException.class)
                .hasMessage("ARK_API_KEY 未配置");
    }
}
