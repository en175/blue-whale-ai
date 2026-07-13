package com.blue.whale.agent.model.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.experimental.Accessors;

/**
 * 「我的 Skills」列表项（GET /api/skills/mine）。
 *
 * <p>关系 + auto + skill 内容快照（join skill）。
 * my tab 数据自足，不依赖 library 分页结果。
 */
@Getter
@Setter
@Accessors(chain = true)
@NoArgsConstructor
@AllArgsConstructor
public class SkillMineDto {

    /** → skill.id */
    private Long skillId;

    /** auto 开关（关系属性） */
    private Boolean auto;

    /** 展示名 */
    private String name;

    /** 中文描述 */
    private String description;

    /** 封面图 URL */
    private String coverUrl;

    /** official / community */
    private String source;
}
