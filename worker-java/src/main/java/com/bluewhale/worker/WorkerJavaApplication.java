package com.bluewhale.worker;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * 薄执行器生成服务入口（ADR-0084）。
 *
 * <p>硬边界：本进程不实现任何 job 状态机。claim / fencing / 租约 / 结算的权威在
 * NestJS backend，经 internal endpoints 暴露
 * （契约文档 docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md §4）。
 * 本进程只做：消费 MQ → 调上游生成 → 通过端点回报结果。
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class WorkerJavaApplication {

    public static void main(String[] args) {
        SpringApplication.run(WorkerJavaApplication.class, args);
    }
}
