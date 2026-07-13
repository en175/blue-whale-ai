package com.blue.whale.agent.model.dto;

import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

/**
 * 「我的 Skills」分页查询（POST /api/skills/mine），与 library 一致滚动加载。
 */
@Getter
@Setter
@Accessors(chain = true)
public class SkillMineQuery {

    private Long pageNum = 1L;
    private Long pageSize = 50L;
}
