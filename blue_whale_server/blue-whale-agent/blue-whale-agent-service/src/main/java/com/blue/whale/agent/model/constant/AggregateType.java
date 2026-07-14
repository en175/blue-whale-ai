package com.blue.whale.agent.model.constant;

/**
 * 聚合类型常量（ADR-0016 §4 事件封套 aggregate_type）。
 *
 * <p>表达产生产品事件的领域聚合种类，用于事件封套与 Outbox 路由。
 */
public final class AggregateType {

    private AggregateType() {
    }

    /** 聚合：project */
    public static final String PROJECT = "project";
    /** 聚合：generation_job */
    public static final String GENERATION_JOB = "generation_job";
}
