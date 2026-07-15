package com.blue.whale.agent.model.dto;

/**
 * 火山视频任务查询结果（{@code GetContentGenerationTaskResponse} 摘要）。
 *
 * @param status    火山任务状态：queued / running / succeeded / failed / cancelled
 * @param videoUrl  生成成功时的视频 url（24h 过期，需后端转存）
 * @param errorCode 失败错误码（火山侧）
 * @param errorMsg  失败错误消息
 */
public record VideoTaskDto(String status, String videoUrl, String errorCode, String errorMsg) {
}
