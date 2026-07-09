package com.bluewhale.agent.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link AsyncConfig} 测试：generationExecutor bean 装配 + 类型/线程池参数校验。
 */
@SpringBootTest(classes = AsyncConfig.class)
class AsyncConfigTest {

    @Autowired
    @Qualifier(AsyncConfig.GENERATION_EXECUTOR)
    private Executor generationExecutor;

    @Test
    void executorBeanCreated() {
        assertThat(generationExecutor).isNotNull();
    }

    @Test
    void executorIsThreadPoolTaskExecutor() {
        assertThat(generationExecutor).isInstanceOf(ThreadPoolTaskExecutor.class);
    }

    @Test
    void poolSizeConfigured() {
        ThreadPoolTaskExecutor pool = (ThreadPoolTaskExecutor) generationExecutor;
        assertThat(pool.getCorePoolSize()).isEqualTo(2);
        assertThat(pool.getMaxPoolSize()).isEqualTo(8);
    }
}
