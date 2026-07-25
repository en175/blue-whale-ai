package com.blue.whale.agent.model.dto;

/**
 * §7 Creative Skill 推荐项（IK3NPI）：契约封闭形状，仅 4 字段。
 *
 * <p>数据源为 Java Skill Library（user_skill JOIN creative_skill），仅列出不属于本 Run 冻结
 * auto 候选、但可向用户推荐的 Skill；{@code activationEligibility} 恒 {@code requires_user_use}
 * ——推荐不构成自动激活授权，用户点击 Use 后由目标新 Run 的消息按契约 §2 重新解析版本。
 * 不携带版本 ID / 摘要 / 正文。SNAKE_CASE 序列化由全局 Jackson 策略保证。
 */
public record CreativeSkillRecommendationResponse(
        String creativeSkillId,
        String name,
        String description,
        String activationEligibility
) {}
