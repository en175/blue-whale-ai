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
    /** 聚合：canvas */
    public static final String CANVAS = "canvas";
    /** 聚合：conversation */
    public static final String CONVERSATION = "conversation";
    /** 聚合：agent_run */
    public static final String AGENT_RUN = "agent_run";
    /** 聚合：generation_job */
    public static final String GENERATION_JOB = "generation_job";
    /** 聚合：generation_job_output */
    public static final String GENERATION_JOB_OUTPUT = "generation_job_output";
    /** 聚合：asset */
    public static final String ASSET = "asset";
}
