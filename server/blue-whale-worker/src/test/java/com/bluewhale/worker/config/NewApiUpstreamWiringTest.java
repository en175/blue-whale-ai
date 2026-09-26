package com.bluewhale.worker.config;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
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

/**
 * 「上游地址唯一出口」的**装配**钉桩。
 *
 * <p>为什么需要它：17 个客户端 bean 全部改成「构造器注入 {@link UpstreamBaseUrl}」之后，
 * 装配是否正确**没有任何编译期保障**，而本仓没有起全量 Spring 上下文的测试——客户端带着
 * 多个未注解的构造器、或地址 bean 缺失，都只在应用真起进程时才炸。本测试写出来当场就抓到
 * 了第一条（{@code NewApiImageClient} 有两个构造器 → Spring 退回默认构造器 →
 * {@code No default constructor found}），功能测试全绿也照样漏。
 *
 * <p>与 {@code StartupContractTest} 分工：那边钉「地址怎么解析、缺/空白怎么被拒」
 * （守卫是 {@link UpstreamBaseUrl} 自身的不变式，空白根本构造不出来，也就进不到客户端），
 * 这边钉「18 个客户端都从这**一个** bean 拿地址」——17 个 @Component 走扫包，另 1 个
 * 手工 @Bean 的见 {@link #handWiredVideoClientTakesTheBaseUrlBean()}。
 */
class NewApiUpstreamWiringTest {

    /** 只扫两个客户端包（这两个包里除 new-api 客户端外没有别的 @Component）。 */
    @Configuration
    @ComponentScan(basePackages = {
            "com.bluewhale.worker.infrastructure.gateway",
            "com.bluewhale.worker.infrastructure.audio"})
    static class ClientScanFixture {}

    /**
     * 地址 bean 用 {@code withBean} 提供而不起 {@link NewApiUpstreamConfig}：后者的统一 key
     * 走 {@code System.getenv}（部署注入，runner 里喂不到），带上它会让本测试的失败点漂到 key 守卫上。
     */
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(ClientScanFixture.class)
            .withBean(UpstreamBaseUrl.class, () -> new UpstreamBaseUrl("http://new-api.invalid"));

    @Test
    @DisplayName("17 个扫包客户端全部从唯一地址 bean 装配起来（无一各自读 env）")
    void allClientsAssembleFromSingleBaseUrlBean() {
        runner.run(ctx -> {
            // 单例饿汉装配：上下文起得来 = 17 个客户端都拿到了地址
            assertThat(ctx.getStartupFailure()).isNull();

            // 出口唯一：多一个同类型 bean 会让注入点变歧义
            assertThat(ctx).hasSingleBean(UpstreamBaseUrl.class);

            // 造型各异的几个代表（多构造器 / 异包 / 内嵌双端点）
            assertThat(ctx).hasSingleBean(NewApiImageClient.class);
            assertThat(ctx).hasSingleBean(NewApiMaterialClient.class);
            assertThat(ctx).hasSingleBean(NewApiAudioClient.class);
            assertThat(ctx).hasSingleBean(NewApiMediaKitMatteVideoClient.class);
            assertThat(ctx).hasSingleBean(NewApiMediaKitSeparateVoiceClient.class);
        });
    }

    /**
     * 手工 {@code @Bean} 装配的那一个（{@code RocketMqConfig#newApiVideoClient}，不是
     * {@code @Component}，扫包扫不到）。
     * <p>
     * 为什么不起上下文：{@code RocketMqConfig} 同时声明 17 个消费者
     * （{@code @Bean(initMethod = "start")}），无 broker 的机器上装配必然失败
     * （{@code StartupContractTest} 同款说明）；而 MQ 守卫 bean 在声明序里排在它前面，
     * 一抛就轮不到验证这个客户端——正是 {@code NewApiImageClient} 那类盲区。
     * 直调 {@code @Bean} 方法：入参形状（唯一依赖 = 地址 bean）由编译期钉住，
     * 构造器换了类型或地址 bean 不匹配即红。
     */
    @Test
    @DisplayName("手工 @Bean 的 NewApiVideoClient 也从同一个地址 bean 取地址")
    void handWiredVideoClientTakesTheBaseUrlBean() {
        NewApiVideoClient client = new RocketMqConfig()
                .newApiVideoClient(new UpstreamBaseUrl("http://new-api.invalid"));
        assertThat(client).isNotNull();
    }
}
