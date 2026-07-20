package com.blue.whale.agent.model.dto;

import java.util.List;
import java.util.Map;

/**
 * Project 快照响应（ADR-0016 §2 恢复入口）。
 *
 * <p>提供 Project、当前 GenerationJob、Canvas 引用，以及 {@code high_watermark_cursor}。
 * 快照状态至少反映到该高水位游标，客户端随后只需订阅该游标之后的增量。
 * @param project             项目信息
 * @param canvas              画布（Asset 引用）
 * @param conversationMessages Conversation 可见消息
 * @param agentRuns           当前及历史 AgentRun
 * @param generationJobs      当前及历史 GenerationJob
 * @param assets              job 产出 Asset 的 id→摘要映射（含产品受控访问地址）
 * @param highWatermarkCursor 高水位游标（客户端从该游标接续 SSE）
 */
public record SnapshotResponse(
        ProjectDto project,
        CanvasDto canvas,
        List<ConversationMessageDto> conversationMessages,
        List<AgentRunDto> agentRuns,
        List<GenerationJobDto> generationJobs,
        Map<Long, AssetDto> assets,
        long highWatermarkCursor) {

    /** Conversation 消息事实（Snapshot 切片）。 */
    public record ConversationMessageDto(
            Long messageId,
            Long conversationId,
            Long agentRunId,
            String role,
            String content,
            Integer sequenceNo,
            String streamId,
            String status,
            Integer lastChunkSequence) {
    }

    /** AgentRun 权威状态（Snapshot 切片）。 */
    public record AgentRunDto(
            Long agentRunId,
            Long conversationId,
            String status,
            String stage,
            String engine,
            String engineVersion,
            Integer adapterSchemaVersion,
            Long currentCheckpointId,
            Integer version,
            UserInputRequestDto activeInputRequest) {
    }

    /**
     * UserInputRequest 产品中性切片（ADR-0016 §2 要求返回 AgentRun 当前活动请求）。
     *
     * <p>不含成本版本字段（quotedAmountFen/provider/catalog 等），避免供应商私有信息泄漏到 Snapshot。
     * 创作澄清暴露可见问题；成本确认暴露动作身份与类型，供前端展示待确认动作。
     */
    public record UserInputRequestDto(
            Long inputRequestId,
            String requestType,
            String question,
            String actionIdentity,
            String actionType,
            String status,
            java.time.LocalDateTime expiresAt) {
    }

    /** GenerationJob 摘要（Snapshot 切片）。 */
    public record GenerationJobDto(
            Long jobId,
            Long agentRunId,
            String actionIdentity,
            Integer expectedOutputCount,
            Long retryOfJobId,
            String type,
            String source,
            Map<String, Object> input,
            String status,
            Integer progress,
            Map<String, Object> error,
            List<Long> outputAssetIds,
            List<GenerationJobOutputDto> outputs) {
    }

    /** GenerationJob 输出槽事实。 */
    public record GenerationJobOutputDto(
            Integer slotIndex,
            String status,
            Long assetId,
            Map<String, Object> error) {
    }

    /** Asset 摘要（Snapshot 切片）。 */
    public record AssetDto(Long assetId, String accessUrl, String type) {
    }
}
