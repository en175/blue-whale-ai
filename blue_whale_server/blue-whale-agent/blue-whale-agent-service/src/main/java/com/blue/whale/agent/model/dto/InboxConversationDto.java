package com.blue.whale.agent.model.dto;

import java.time.LocalDateTime;

/**
 * 生成收件箱对话条目（IK21O9）。
 *
 * @param id        对话 id
 * @param createdAt 创建时间（前端 snake_case：{@code created_at}）
 * @param preview   预览：该对话首条 user 消息截 50 字，无消息为空串
 */
public record InboxConversationDto(Long id, LocalDateTime createdAt, String preview) {
}
