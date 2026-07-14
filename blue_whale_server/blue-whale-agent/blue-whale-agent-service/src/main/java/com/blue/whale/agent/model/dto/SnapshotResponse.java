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
 * @param assets              job 产出 Asset 的 id→摘要映射（含签名 URL）
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
            Integer sequenceNo) {
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
            Integer version) {
    }

    /** GenerationJob 摘要（Snapshot 切片）。 */
    public record GenerationJobDto(
            Long jobId,
            Long agentRunId,
            String actionIdentity,
            String type,
            String source,
            Map<String, Object> input,
            String status,
            Integer progress,
            List<Long> outputAssetIds,
            List<GenerationJobOutputDto> outputs) {
    }

    /** GenerationJob 输出槽事实。 */
    public record GenerationJobOutputDto(Integer slotIndex, Long assetId) {
    }

    /** Asset 摘要（Snapshot 切片）。 */
    public record AssetDto(Long assetId, String accessUrl, String type) {
    }
}
