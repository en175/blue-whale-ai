package com.blue.whale.agent.model.dto;

/**
 * 生成收件箱视图（IK21O9）：每用户一个 purpose=generation_inbox 的隐藏 Project。
 *
 * @param project             收件箱项目
 * @param activeConversationId 当前活动对话 id（最新一段对话；无对话时为 null）
 */
public record GenerationInboxDto(ProjectDto project, Long activeConversationId) {
}
