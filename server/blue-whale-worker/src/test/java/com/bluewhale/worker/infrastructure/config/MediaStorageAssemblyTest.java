package com.bluewhale.worker.infrastructure.config;

import com.bluewhale.worker.infrastructure.storage.TosMediaStorage;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.assertj.AssertableApplicationContext;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

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
