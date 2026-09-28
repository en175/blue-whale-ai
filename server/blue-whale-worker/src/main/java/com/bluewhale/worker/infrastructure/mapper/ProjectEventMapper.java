package com.bluewhale.worker.infrastructure.mapper;

import com.bluewhale.worker.domain.entity.ProjectEventEntity;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * 项目事件 Mapper（契约 §3.3：终态写事件）。
 */
@Mapper
public interface ProjectEventMapper extends BaseMapper<ProjectEventEntity> {

    /**
     * 获取下一个 cursor 值（project_events 按 project_id 分区自增）。
     */
    @Select("""
            SELECT COALESCE(MAX(`cursor`), 0) + 1
            FROM project_events
            WHERE project_id = #{projectId}
            """)
    Long nextCursor(@Param("projectId") Long projectId);
}
