package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

/**
 * 技能库（权威内容）。seed 来源 {@code blue-whale-agent-workspace/skill/library/raw/*.md}。
 *
 * <p>「我的 Skills」是引用非副本——内容字段(name/description/content)更新，「我的」跟随。
 * {@code auto} 不在此表，挂 {@link UserSkill} 关系上。
 */
@Getter
@Setter
@Accessors(chain = true)
@TableName("skill")
public class Skill extends BaseEntity {

    /** 展示名（文件名 cnXX- 生成，唯一，seed 去重用） */
    private String name;

    /** raw frontmatter description（中文描述） */
    private String description;

    /** md 全文（frontmatter + 正文），P0 面板不展示，留给 Agent 联调 */
    private String content;

    /** 来源：official / community */
    private String source;

    /** 排序：cn 编号 1..60 */
    private Integer sortOrder;

    /** 封面 URL（P0 留空，前端走占位） */
    private String coverUrl;
}
