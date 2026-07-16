package com.blue.whale.agent.model.dto;

import java.util.Map;

/**
 * 任务状态查询响应（前端轮询）。
 *
 * @param jobId    任务 id
 * @param status   queued / processing / succeeded / failed
 * @param progress 进度 0-100
 * @param asset    成功时的输出资源（可为 null）
 * @param error    失败时的安全错误信封（可为 null）
 */
public record JobStatusResponse(
        Long jobId,
        String status,
        Integer progress,
        AssetDto asset,
        Map<String, Object> error) {

    /** 输出资源摘要。 */
    public record AssetDto(Long id, String url, String type) {
    }
}
