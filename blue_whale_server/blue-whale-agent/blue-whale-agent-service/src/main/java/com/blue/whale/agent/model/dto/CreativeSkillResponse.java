package com.blue.whale.agent.model.dto;

/**
 * list_creative_skills 响应项（IK2QC7）：单个 Creative Skill 的紧凑元数据。
 *
 * 数据源为 Run 固定的 {@code bundleVersionId} 发布快照 {@code composition.resourceManifest.resources}
 * 里 {@code kind="creative_skill"} 的资源。creativeSkillId / version 标识具体技能版本，
 * name / description / allowImplicitInvocation 来自资源 metadata，供 Agent 在对话中自然推荐。
 * 当前 Bundle 无 creative_skill 资源时列表为空。
 */
public record CreativeSkillResponse(
        String creativeSkillId,
        String version,
        String name,
        String description,
        Boolean allowImplicitInvocation
) {}
