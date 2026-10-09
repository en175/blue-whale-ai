package com.bluewhale.worker.infrastructure.config;

import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.infrastructure.audio.NewApiAudioClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiImageClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMaterialClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMatteVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSeparateVoiceClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;

class NewApiUpstreamWiringTest {

    @Configuration
    @ComponentScan(basePackages = {
            "com.bluewhale.worker.infrastructure.gateway",
            "com.bluewhale.worker.infrastructure.audio"})
    static class ClientScanFixture {}

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(ClientScanFixture.class)
            .withBean(UpstreamBaseUrl.class, () -> new UpstreamBaseUrl("http://new-api.invalid"));

    @Test
    @DisplayName("17 个扫包客户端全部从唯一地址 bean 装配起来（无一各自读 env）")
    void allClientsAssembleFromSingleBaseUrlBean() {
        runner.run(ctx -> {
            assertThat(ctx.getStartupFailure()).isNull();

            assertThat(ctx).hasSingleBean(UpstreamBaseUrl.class);

            assertThat(ctx).hasSingleBean(NewApiImageClient.class);
            assertThat(ctx).hasSingleBean(NewApiMaterialClient.class);
            assertThat(ctx).hasSingleBean(NewApiAudioClient.class);
            assertThat(ctx).hasSingleBean(NewApiMediaKitMatteVideoClient.class);
            assertThat(ctx).hasSingleBean(NewApiMediaKitSeparateVoiceClient.class);
        });
    }

    @Test
    @DisplayName("手工 @Bean 的 NewApiVideoClient 也从同一个地址 bean 取地址")
    void handWiredVideoClientTakesTheBaseUrlBean() {
        NewApiVideoClient client = new RocketMqConfig()
                .newApiVideoClient(new UpstreamBaseUrl("http://new-api.invalid"));
        assertThat(client).isNotNull();
    }
}
