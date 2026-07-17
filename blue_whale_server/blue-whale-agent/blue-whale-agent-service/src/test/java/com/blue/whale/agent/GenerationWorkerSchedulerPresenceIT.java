package com.blue.whale.agent;

import com.blue.whale.agent.service.generation.GenerationWorkerScheduler;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 生成 Worker 调度器在容器中的存在性回归（IK1NS2）。
 *
 * <p>本地 MVP（mode=fake）依赖内嵌 {@code GenerationWorkerScheduler} 定时认领
 * GenerationJob；此前它以 {@code @Component + @ConditionalOnBean} 形式挂在扫描组件上，
 * 条件因注册顺序看不到配置类 {@code @Bean}，调度器被静默跳过（job 永远 queued，
 * 而 IT 只直调 runOnce 覆盖不到）。本测试用与部署一致的 mode=fake 装配，
 * 在完整上下文中硬断言调度器 bean 存在。
 */
@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "blue-whale.generation.mode=fake",
        "blue-whale.generation.fake-allowed=true",
        "blue-whale.generation.worker-scheduled=true",
        "volcengine.ark.base-url=https://ark.test.invalid",
        "blue-whale.agent-orchestrator.engine=fake",
        "blue-whale.agent-orchestrator.engine-version=1",
        "blue-whale.agent-orchestrator.adapter-schema-version=1"
})
@ActiveProfiles("test")
class GenerationWorkerSchedulerPresenceIT {

    @Autowired
    private ApplicationContext context;

    @Test
    void generationWorkerSchedulerBeanExists() {
        assertThat(context.getBean(GenerationWorkerScheduler.class)).isNotNull();
    }
}
