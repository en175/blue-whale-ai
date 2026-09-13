package com.bluewhale.worker.config;

import com.bluewhale.worker.infrastructure.storage.TosMediaStorage;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 装配回归（多阶段 docker build 首验抓出的裸 env 启动崩溃）：
 * TosMediaStorage 曾是无条件 @Component，空 WORKER_ENABLED_TAGS 安全拉起被其构造器打崩，
 * 违反 README 承诺——与二轮评审 NewApiAudioClient/NewApiImageClient 门控缺失同类。
 * 本测试把「tag → 是否实例化」钉成可回放断言，不再依赖人肉起容器。
 */
class MediaStorageAssemblyTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(TosMediaStorage.class);

    @Test
    @DisplayName("空 tag → 不实例化（兑现空 env 只起 /ready；修复前此场景必崩）")
    void emptyTagsSkipsStorage() {
        runner.withPropertyValues("worker.enabled-tags=").run(ctx ->
                assertThat(ctx).doesNotHaveBean(TosMediaStorage.class));
    }

    @Test
    @DisplayName("step-only → 不实例化（video 走 TosVideoMediaRelay，TOS 缺省 null 宽容降级，不应被本 bean 硬拦）")
    void stepOnlySkipsStorage() {
        runner.withPropertyValues("worker.enabled-tags=step").run(ctx ->
                assertThat(ctx).doesNotHaveBean(TosMediaStorage.class));
    }

    @Test
    @DisplayName("media_extract → 条件放行、构造被尝试（缺 VOLC_* 时是构造器 IllegalStateException，而非 bean 未注册）")
    void extractTagsAttemptsStorage() {
        runner.withPropertyValues("worker.enabled-tags=media_extract").run(ctx -> {
            Throwable failure = ctx.getStartupFailure();
            if (failure != null) {
                // 常见情形（CI 无 VOLC_*）：门控放行、构造到 TosMediaStorage 构造器才失败
                assertThat(chainContains(failure, "TOS configuration required"))
                        .as("启动失败必须源于 TOS 配置检查（门控语义=尝试构造），实际：%s", failure).isTrue();
            } else {
                // 本机 export 了 VOLC_* 时：可构造 = 同样证明门控放行
                assertThat(ctx).hasSingleBean(TosMediaStorage.class);
            }
        });
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
