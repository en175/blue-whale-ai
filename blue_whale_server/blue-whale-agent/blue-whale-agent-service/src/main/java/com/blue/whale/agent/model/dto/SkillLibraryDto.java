package com.blue.whale.agent.model.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.experimental.Accessors;

/**
 * Skill 库列表项（GET /api/skills/library）。
 *
 * <p>{@code coverUrl} = skill.cover_url（普通图 URL，空则前端用默认图）。
 * {@code added} = 当前用户视角的「已添加到我的」标记（库 ⊃ 我的 同源一致）。
 */
@Getter
@Setter
@Accessors(chain = true)
@NoArgsConstructor
@AllArgsConstructor
public class SkillLibraryDto {

    /** skill.id */
    private Long id;

    /** 展示名 */
    private String name;

    /** 中文描述 */
    private String description;

    /** 封面图 URL（空 → 前端默认图） */
    private String coverUrl;

    /** official / community */
    private String source;

    /** 当前用户是否已添加到「我的」 */
    private Boolean added;

    /** Creative Skill 稳定字符串身份（IK3NPB，1B 经 source_skill_id 映射回查；wire → creative_skill_id） */
    private String creativeSkillId;
}
