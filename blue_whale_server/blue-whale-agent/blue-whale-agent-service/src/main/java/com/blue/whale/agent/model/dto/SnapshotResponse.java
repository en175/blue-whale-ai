package com.blue.whale.agent.model.dto;

import java.util.List;
import java.util.Map;

/**
 * Project 快照响应（ADR-0016 §2 恢复入口）。
 *
 * <p>提供 Project、当前 GenerationJob、Canvas 引用，以及 {@code high_watermark_cursor}。
 * 快照状态至少反映到该高水位游标，客户端随后只需订阅该游标之后的增量。
 * 首版不含 Conversation / AgentRun / UserInputRequest（聚合尚未落地，后续工单）。
 *
 * @param project             项目信息
 * @param canvas              画布（Asset 引用）
 * @param generationJobs      当前及历史 GenerationJob
 * @param assets              job 产出 Asset 的 id→摘要映射（含签名 URL）
 * @param highWatermarkCursor 高水位游标（客户端从该游标接续 SSE）
 */
public record SnapshotResponse(
        ProjectDto project,
        CanvasDto canvas,
        List<GenerationJobDto> generationJobs,
        Map<Long, AssetDto> assets,
        long highWatermarkCursor) {

    /** GenerationJob 摘要（Snapshot 切片）。 */
    public record GenerationJobDto(
            Long jobId,
            String type,
            String status,
            Integer progress,
            List<Long> outputAssetIds) {
    }

    /** Asset 摘要（Snapshot 切片）。 */
    public record AssetDto(Long assetId, String url, String type) {
    }
}
