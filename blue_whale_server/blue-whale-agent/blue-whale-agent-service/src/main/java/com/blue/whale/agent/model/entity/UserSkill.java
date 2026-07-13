package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

/**
 * 用户技能引用关系（user ──skill_id──> skill）。「我的 Skills」= 该表的子集。
 *
 * <p>{@code auto} 是关系属性（非 skill 属性）：同一 skill，A 用户开 auto、B 用户关，互不影响。
 * 解除引用不删 skill 本身（仅逻辑删本行）。
 */
@Getter
@Setter
@Accessors(chain = true)
@TableName("user_skill")
public class UserSkill extends BaseEntity {

    /** 用户ID（X-User-Id 头） */
    private Long userId;

    /** 技能ID（→ skill.id） */
    private Long skillId;

    /** auto 开关：true=Agent 自主选用，false=仅手动 Use */
    private Boolean auto;
}
