package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.GenerationJobOutput;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

public interface GenerationJobOutputMapper extends BaseMapper<GenerationJobOutput> {

    @Select("SELECT * FROM generation_job_outputs "
            + "WHERE generation_job_id = #{jobId} AND slot_index = #{slotIndex} "
            + "AND is_delete = 0 FOR UPDATE")
    GenerationJobOutput selectForUpdate(
            @Param("jobId") Long jobId,
            @Param("slotIndex") int slotIndex);

    @Select("SELECT * FROM generation_job_outputs "
            + "WHERE generation_job_id = #{jobId} AND status = 'pending' "
            + "AND is_delete = 0 ORDER BY slot_index LIMIT 1 FOR UPDATE")
    GenerationJobOutput selectNextPendingForUpdate(@Param("jobId") Long jobId);

    @Select("SELECT job_output.* FROM generation_job_outputs job_output "
            + "JOIN generation_provider_tasks provider_task "
            + "ON provider_task.generation_job_id = job_output.generation_job_id "
            + "AND provider_task.slot_index = job_output.slot_index "
            + "AND provider_task.is_delete = 0 "
            + "WHERE job_output.generation_job_id = #{jobId} AND job_output.status = 'failed' "
            + "AND job_output.is_delete = 0 AND provider_task.provider_task_id IS NOT NULL "
            + "ORDER BY COALESCE(provider_task.observe_count, 0), job_output.slot_index "
            + "LIMIT 1 FOR UPDATE")
    GenerationJobOutput selectFailedForEvidenceForUpdate(@Param("jobId") Long jobId);

    @Select("SELECT * FROM generation_job_outputs "
            + "WHERE generation_job_id = #{jobId} AND is_delete = 0 "
            + "ORDER BY slot_index FOR UPDATE")
    List<GenerationJobOutput> selectByJobForUpdate(@Param("jobId") Long jobId);

    /**
     * 组图模式：查 Job 的 pending 槽序号（升序）。
     * <p>不加 {@code FOR UPDATE}：组图由 claim 的 lease 独占（claim0 持有期间调度 SQL 不让别 worker 抢），
     * 此查询仅为确定单次方舟调用需回填的张数与槽位（IK24Q9）。
     */
    @Select("SELECT slot_index FROM generation_job_outputs "
            + "WHERE generation_job_id = #{jobId} AND status = 'pending' "
            + "AND is_delete = 0 ORDER BY slot_index")
    List<Integer> selectPendingSlotIndexesByJob(@Param("jobId") Long jobId);

    /** 物理删除项目全部生成任务的输出槽位（生成收件箱永久删除用，绕过逻辑删除）。 */
    @Delete("DELETE FROM generation_job_outputs WHERE generation_job_id IN "
            + "(SELECT id FROM generation_jobs WHERE project_id = #{projectId})")
    int hardDeleteByGenerationJobProjectId(@Param("projectId") Long projectId);
}
