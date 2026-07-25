package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.RunCommitRecord;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;

public interface RunCommitRecordMapper extends BaseMapper<RunCommitRecord> {

    /** 物理删除项目全部 AgentRun 的 commit 记录（生成收件箱永久删除用，绕过逻辑删除）。 */
    @Delete("DELETE FROM run_commits WHERE agent_run_id IN "
            + "(SELECT id FROM agent_runs WHERE project_id = #{projectId})")
    int hardDeleteByAgentRunProjectId(@Param("projectId") Long projectId);
}
