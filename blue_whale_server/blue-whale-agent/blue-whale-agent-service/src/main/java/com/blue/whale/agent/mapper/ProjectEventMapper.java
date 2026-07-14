package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.ProjectEvent;

/**
 * 产品事件 Mapper：复用 MyBatis-Plus {@link BaseMapper}，被 {@code @MapperScan} 扫到。
 *
 * <p>游标分配的 {@code SELECT ... FOR UPDATE} 锁定在 {@link com.blue.whale.agent.mapper.ProjectEventStreamMapper}
 * 提供，本 Mapper 只负责事件日志的增删改查。
 */
public interface ProjectEventMapper extends BaseMapper<ProjectEvent> {
}
