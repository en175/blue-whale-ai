package com.blue.whale.agent.model.dto;

import java.util.List;
import java.util.Map;

/**
 * read_generation_job_status 响应（IK2QC7）：单个生成任务的紧凑状态。
 *
 * status 为 {@link com.blue.whale.agent.model.entity.GenerationJob} 状态枚举
 * （queued/processing/succeeded/partially_succeeded/failed/cancel_requested/cancelled），
 * progress 为 0-100，error 为 {code, message} 信封（无错时 null），outputAssetIds 为输出 Asset id 列表。
 */
public record GenerationJobStatusResponse(
        Long jobId,
        String type,
        String status,
        Integer progress,
        Map<String, Object> error,
        List<Long> outputAssetIds
) {}
