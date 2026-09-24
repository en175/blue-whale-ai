package com.bluewhale.billing;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * 计费控制面启动类（ADR-0113 / ADR-0114）。
 *
 * <p>与 worker 的分工：worker 是执行面（长任务、崩溃可重启、发版频繁）；
 * billing 是控制面（被同步调用、强一致、不容失败）。**故障域完全不同**，
 * 所以不复用进程、只复用基础设施（{@code server/blue-whale-common}）。
 *
 * <p>⚠️ 当前是骨架：只有启动类与健康检查，业务能力按 ADR-0113 的 P2–P6 分期落地。
 *
 * <p>对外契约见 {@code contracts/proto/billing/v1/}（Buf proto，语言中立）——
 * 本服务是它的 Java 侧实现方。
 */
@SpringBootApplication
public class BillingApplication {

    public static void main(String[] args) {
        SpringApplication.run(BillingApplication.class, args);
    }
}
