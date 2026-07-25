package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.GenerationProviderTask;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

public interface GenerationProviderTaskMapper extends BaseMapper<GenerationProviderTask> {

    @Select("SELECT COUNT(*) FROM generation_provider_tasks WHERE generation_job_id = #{jobId} "
            + "AND is_delete = 0")
    long countByJob(@Param("jobId") Long jobId);

    @Select("SELECT * FROM generation_provider_tasks WHERE generation_job_id = #{jobId} "
            + "AND slot_index = #{slotIndex} AND is_delete = 0 FOR UPDATE")
    GenerationProviderTask selectByJobAndSlotForUpdate(
            @Param("jobId") Long jobId,
            @Param("slotIndex") int slotIndex);

    @Select("SELECT * FROM generation_provider_tasks WHERE generation_job_id = #{jobId} "
            + "AND provider_task_id = #{providerTaskId} AND is_delete = 0 FOR UPDATE")
    GenerationProviderTask selectByJobAndProviderTaskForUpdate(
            @Param("jobId") Long jobId,
            @Param("providerTaskId") String providerTaskId);

    /** 物理删除项目全部生成任务的 Provider 任务（生成收件箱永久删除用，绕过逻辑删除）。 */
    @Delete("DELETE FROM generation_provider_tasks WHERE generation_job_id IN "
            + "(SELECT id FROM generation_jobs WHERE project_id = #{projectId})")
    int hardDeleteByGenerationJobProjectId(@Param("projectId") Long projectId);
}
