package com.blue.whale.agent.model.request;

import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

/**
 * Skill 库分页查询（POST /api/skills/library）。
 *
 * <p>默认第 1 页、50 条/页。keyword 可空，匹配 name/description。
 */
@Getter
@Setter
@Accessors(chain = true)
public class SkillLibraryRequest {

    /** 页码（1-based），默认 1 */
    private Long pageNum = 1L;

    /** 每页条数，默认 50 */
    private Long pageSize = 50L;

    /** 搜索关键词（匹配 name/description），可空 */
    private String keyword;
}
