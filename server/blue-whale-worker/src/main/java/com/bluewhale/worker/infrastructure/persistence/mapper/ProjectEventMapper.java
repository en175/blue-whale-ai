package com.bluewhale.worker.infrastructure.persistence.mapper;

import com.bluewhale.worker.domain.entity.ProjectEventEntity;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface ProjectEventMapper extends BaseMapper<ProjectEventEntity> {

    @Select("""
            SELECT id
            FROM project
            WHERE id = #{projectId}
            FOR UPDATE
            """)
    Long lockProject(@Param("projectId") Long projectId);

    @Select("""
            SELECT `cursor`
            FROM project_events
            WHERE project_id = #{projectId}
            ORDER BY `cursor` DESC
            LIMIT 1
            FOR UPDATE
            """)
    Long latestCursor(@Param("projectId") Long projectId);

    default Long nextCursor(Long projectId) {
        lockProject(projectId);
        Long latest = latestCursor(projectId);
        return latest == null ? 1L : latest + 1;
    }
}
