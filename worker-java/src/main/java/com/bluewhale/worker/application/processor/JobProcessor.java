package com.bluewhale.worker.application.processor;

/**
 * Job 处理器策略接口（STRATEGY 注册表，当前仅 MediaExtractProcessor）。
 * <p>
 * 设计约束（IKENSZ pattern spec）：Spring 单例 bean，按 tag 注册。
 * 不引入额外抽象层——只有确实存在多轴变化时才扩展。
 */
public interface JobProcessor {

    /** 处理的 MQ tag（与 generation_jobs.type 一致）。 */
    String tag();

    /**
     * 处理一个 job。
     *
     * @param jobId job ID（字符串，media_extract 不做 digitGuard）
     * @throws RuntimeException 抛错 → consumer 不 ack → broker 30s 重投（契约 §1）
     */
    void handle(String jobId);
}
