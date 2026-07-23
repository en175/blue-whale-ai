package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

/**
 * Creative Skill 稳定身份表（IK3NPB）。
 *
 * <p>与旧 {@link Skill} 表并存（1B 决策）：旧表原封不动，本表自记 {@code source_skill_id} 映射。
 * {@code creative_skill_id} 为稳定字符串身份（正则 {@code ^[a-z][a-z0-9_]{2,79}$}），
 * {@code active_version_id} 指向当前发布版本（仿 {@code active_bundle_version_id}）。
 * 无 version/is_delete 列（与 runtime_agent_definitions 一致，不走逻辑删/乐观锁）。
 */
@Getter
@Setter
@Accessors(chain = true)
@TableName("creative_skill")
public class CreativeSkill {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 稳定字符串身份，正则 ^[a-z][a-z0-9_]{2,79}$ */
    private String creativeSkillId;

    /** 展示名（来自 skill.name） */
    private String name;

    /** 描述（来自 skill.description） */
    private String description;

    /** 1B 映射：指向 skill.id，可空（将来非 seed 来源） */
    private Long sourceSkillId;

    /** 当前发布版本指针 → creative_skill_version.creative_skill_version_id */
    private String activeVersionId;
}
