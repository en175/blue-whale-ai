package com.blue.whale.agent.model.dto;

/**
 * §6 read_creative_skill_body 响应（IK3NPD-T3）：已激活 Creative Skill 固定版本的正文。
 *
 * <p>Java 按 {@code runId} 从 Run pin 派生固定版本（客户端不能改读其他版本），返回正文与
 * {@code contentDigest}。Worker 读取后必须校验实际字节 SHA-256 同时匹配响应 {@code contentDigest}
 * 与 Run pin 固定的 {@code resourceDigest}（契约 §6 双重校验），字节缺失 / 摘要不符均 fail closed。
 * {@code mediaType} 恒 {@code text/markdown}。SNAKE_CASE 序列化由全局 Jackson 策略保证。
 */
public record CreativeSkillBodyResponse(
        String creativeSkillId,
        String creativeSkillVersionId,
        String mediaType,
        String body,
        String contentDigest
) {}
