package com.blue.whale.agent.model.dto;

/**
 * §6 read_creative_skill_reference 响应（IK3NPD-T3）：已激活版本的单个引用资源。
 *
 * <p>按规范化 POSIX 相对路径 {@code resourcePath} 返回该固定版本下的单个引用资源正文与
 * {@code contentDigest}（契约 §6）。Worker 校验实际字节 SHA-256 与 {@code contentDigest} 一致。
 * 首批 seed 无引用资源，请求任何引用资源返回 {@code CREATIVE_SKILL_CONTENT_MISSING}（100311），
 * 不伪造引用内容。SNAKE_CASE 序列化由全局 Jackson 策略保证。
 */
public record CreativeSkillReferenceResourceResponse(
        String creativeSkillId,
        String creativeSkillVersionId,
        String resourcePath,
        String mediaType,
        String content,
        String contentDigest
) {}
