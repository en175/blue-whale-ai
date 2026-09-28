package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;

import java.util.Optional;

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

    /**
     * 本家族的领取规格（IKIWP8 / ADR-0119）。
     * <p>
     * 15 个工具族处理器 override 返回自己构造的 {@link ClaimSpec}；第 1 类生成型（image / audio /
     * video by-id）仍走 {@code JobClaimService} 的具名方法，返回空。
     * <p>
     * 暴露它的用途不是给测试开口子，而是让「一个处理器 ↔ 一份领取规格」这条不变式**可被断言**：
     * 每个处理器的 {@code claimSpec().type()} 必须等于它自己的 {@code tag()}。领取规格是数据，
     * 复制了别的家族的 spec 却忘了改 type / 候选查询时类型系统不报错——这条纯单元级断言是成本
     * 最低的第一道防线（真库的排他对口测试是第二道）。
     */
    default Optional<ClaimSpec> claimSpec() {
        return Optional.empty();
    }
}
