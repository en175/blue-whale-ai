package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.GenerationResultConflict;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;

public interface GenerationResultConflictMapper extends BaseMapper<GenerationResultConflict> {

    /** 物理删除项目全部生成任务的结果冲突记录（生成收件箱永久删除用，绕过逻辑删除）。 */
    @Delete("DELETE FROM generation_result_conflicts WHERE generation_job_id IN "
            + "(SELECT id FROM generation_jobs WHERE project_id = #{projectId})")
    int hardDeleteByGenerationJobProjectId(@Param("projectId") Long projectId);
}
