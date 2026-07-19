package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.AgentRun;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;

public interface AgentRunMapper extends BaseMapper<AgentRun> {

    @Select("SELECT * FROM agent_runs WHERE engine = #{engine} AND is_delete = 0 "
            + "AND (status = 'queued' OR (status = 'running' AND lease_expires_at < CURRENT_TIMESTAMP)) "
            + "ORDER BY id LIMIT 1 FOR UPDATE")
    AgentRun selectNextQueuedForUpdate(@Param("engine") String engine);

    @Select("SELECT CURRENT_TIMESTAMP")
    LocalDateTime selectCurrentTime();

    @Select("SELECT * FROM agent_runs WHERE id = #{id} AND is_delete = 0 FOR UPDATE")
    AgentRun selectForUpdate(Long id);

    /** 物理删除项目全部 AgentRun（生成收件箱永久删除用，绕过逻辑删除）。 */
    @Delete("DELETE FROM agent_runs WHERE project_id = #{projectId}")
    int hardDeleteByProjectId(@Param("projectId") Long projectId);
}
