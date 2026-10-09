package com.bluewhale.worker.infrastructure.persistence.mapper;

import com.bluewhale.worker.domain.entity.ProjectEventEntity;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface ProjectEventMapper extends BaseMapper<ProjectEventEntity> {

    @Select("""
            SELECT COALESCE(MAX(`cursor`), 0) + 1
            FROM project_events
            WHERE project_id = #{projectId}
            """)
    Long nextCursor(@Param("projectId") Long projectId);
}
