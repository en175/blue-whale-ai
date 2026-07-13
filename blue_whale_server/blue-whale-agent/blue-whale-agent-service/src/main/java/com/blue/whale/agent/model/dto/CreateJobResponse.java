package com.blue.whale.agent.model.dto;

/**
 * 异步任务创建响应（视频生成立即返回）。
 */
public record CreateJobResponse(Long jobId, String status) {
}
