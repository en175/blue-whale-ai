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

    /** Conversation：用户或 Agent 消息已被 Java 接纳。 */
    public static final String CONVERSATION_MESSAGE_ACCEPTED = "conversation.message_accepted";
    /** Conversation：Agent 可见消息已完成。 */
    public static final String CONVERSATION_MESSAGE_COMPLETED = "conversation.message_completed";

    /** AgentRun：已创建。 */
    public static final String AGENT_RUN_CREATED = "agent_run.created";
    /** AgentRun：生命周期状态已变更。 */
    public static final String AGENT_RUN_STATUS_CHANGED = "agent_run.status_changed";
    /** AgentRun：创作澄清输入请求已创建（UserInputRequest 归属 AgentRun，ADR-0016 §5）。 */
    public static final String AGENT_RUN_USER_INPUT_REQUESTED = "agent_run.user_input_requested";
    /** AgentRun：创作澄清输入请求已被自然语言回答。 */
    public static final String AGENT_RUN_USER_INPUT_ANSWERED = "agent_run.user_input_answered";
    /** AgentRun：创作澄清输入请求已过期。 */
    public static final String AGENT_RUN_USER_INPUT_EXPIRED = "agent_run.user_input_expired";

    /** UserInputRequest：Java 策略要求一次性自然语言确认（成本确认，独立聚合，向后兼容）。 */
    public static final String USER_INPUT_REQUEST_CREATED = "user_input_request.created";

    /** GenerationJob：创建 */
    public static final String GENERATION_JOB_CREATED = "generation_job.created";
    /** GenerationJob：状态变更（queued→processing→succeeded|failed） */
    public static final String GENERATION_JOB_STATUS_CHANGED = "generation_job.status_changed";
    /** GenerationJob：稳定输出槽位已绑定 Asset。 */
    public static final String GENERATION_JOB_OUTPUT_ATTACHED = "generation_job.output_attached";
    /** GenerationJob：稳定输出槽位状态已更新。 */
    public static final String GENERATION_JOB_OUTPUT_UPDATED = "generation_job.output_updated";

    /** Asset：产品已接纳不可变媒体对象。 */
    public static final String ASSET_CREATED = "asset.created";
}
