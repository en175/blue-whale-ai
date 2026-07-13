package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.Project;

/**
 * 项目 Mapper：复用 MyBatis-Plus {@link BaseMapper}，被 {@code @MapperScan("com.blue.whale.agent.**.mapper")} 扫到。
 */
public interface ProjectMapper extends BaseMapper<Project> {
}
