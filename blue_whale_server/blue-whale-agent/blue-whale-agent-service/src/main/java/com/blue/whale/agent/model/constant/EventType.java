package com.blue.whale.agent.model.constant;

/**
 * 产品事件类型常量（ADR-0016 §4 首版事件族）。
 *
 * <p>首版只覆盖 Project 与 GenerationJob 生命周期事件；Conversation、AgentRun、UserInputRequest、
 * Asset 独立事件族待对应聚合落地后补充。
 */
public final class EventType {

    private EventType() {
    }

    /** Project：创建 */
    public static final String PROJECT_CREATED = "project.created";
    /** Project：重命名 */
    public static final String PROJECT_RENAMED = "project.renamed";
    /** Project：删除 */
    public static final String PROJECT_DELETED = "project.deleted";

    /** Canvas：整体状态更新 */
    public static final String CANVAS_UPDATED = "canvas.updated";

    /** GenerationJob：创建 */
    public static final String GENERATION_JOB_CREATED = "generation_job.created";
    /** GenerationJob：状态变更（queued→processing→succeeded|failed） */
    public static final String GENERATION_JOB_STATUS_CHANGED = "generation_job.status_changed";
}
