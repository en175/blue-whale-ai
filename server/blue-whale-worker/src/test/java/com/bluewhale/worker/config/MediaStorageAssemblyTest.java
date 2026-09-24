package com.bluewhale.worker.config;

import com.bluewhale.worker.infrastructure.storage.TosMediaStorage;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.assertj.AssertableApplicationContext;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 装配回归（多阶段 docker build 首验抓出的裸 env 启动崩溃）。
 * <p>
 * 历史：TosMediaStorage 曾是无条件 @Component，裸 env 启动被其构造器打崩，于是加了
 * {@code MediaStorageTagsCondition} 按 tag 门控。ADR-0084 修正六退役整套 tag 开关，
 * 本 bean 回到无条件装配——语义从「没配就静默不装配」翻转为「没配就启动期响亮失败」。
 * <p>
 * 本测试把这条翻转钉成可回放断言：无论有无遗留的 {@code worker.enabled-tags} 属性，
 * 构造都必须被尝试；缺 VOLC_* 时以 TOS 配置错误终止启动，而不是静默少一个 bean。
 */
class MediaStorageAssemblyTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(TosMediaStorage.class);

    @Test
    @DisplayName("无条件装配：构造总被尝试（缺 VOLC_* → 构造器 IllegalStateException，而非 bean 未注册）")
    void storageConstructionAlwaysAttempted() {
        runner.run(ctx -> assertConstructedOrLoudlyFailed(ctx));
    }

    @Test
    @DisplayName("遗留 worker.enabled-tags 属性不再能压掉本 bean（开关已退役）")
    void legacyEnabledTagsPropertyCannotSuppressStorage() {
        runner.withPropertyValues(
                        "worker.enabled-tags=",
                        "worker.group-suffix=-java")
                .run(ctx -> assertConstructedOrLoudlyFailed(ctx));
    }

    /**
     * 两种合法结果都证明「构造被尝试」：
     * 本机无 VOLC_* → 启动失败且失败链源于 TOS 配置检查；本机有 VOLC_* → bean 装配成功。
     */
    private static void assertConstructedOrLoudlyFailed(AssertableApplicationContext ctx) {
        Throwable failure = ctx.getStartupFailure();
        if (failure != null) {
            assertThat(chainContains(failure, "TOS configuration required (VOLC_*)"))
                    .as("启动失败必须源于 TOS 配置检查（语义=无条件尝试构造），实际：%s", failure).isTrue();
        } else {
            assertThat(ctx).hasSingleBean(TosMediaStorage.class);
        }
    }

    private static boolean chainContains(Throwable t, String needle) {
        for (Throwable c = t; c != null; c = c.getCause()) {
            if (String.valueOf(c.getMessage()).contains(needle)) {
                return true;
            }
        }
        return false;
    }
}
