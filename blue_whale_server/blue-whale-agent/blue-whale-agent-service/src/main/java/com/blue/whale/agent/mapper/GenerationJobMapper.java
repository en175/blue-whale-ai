package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.GenerationJob;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.LocalDateTime;

/**
 * 生成任务 Mapper：复用 MyBatis-Plus {@link BaseMapper}，扫描自 {@code config.MybatisPlusConfig}（{@code com.bluewhale.**.mapper}）。
 */
public interface GenerationJobMapper extends BaseMapper<GenerationJob> {

    @Select("SELECT * FROM generation_jobs WHERE source IN ('agent_run', 'bottom_dock') AND is_delete = 0 AND ("
            + "(type = 'image' AND (next_action_at IS NULL OR next_action_at <= CURRENT_TIMESTAMP) "
            + "AND (status = 'queued' OR (status IN ('processing', 'cancel_requested') "
            + "AND (lease_expires_at IS NULL OR lease_expires_at < CURRENT_TIMESTAMP)))) "
            + "OR (type = 'video' AND source = 'bottom_dock' "
            + "AND ((status IN ('queued', 'processing', 'cancel_requested') "
            + "AND (next_action_at IS NULL OR next_action_at <= CURRENT_TIMESTAMP)) "
            + "OR (status IN ('failed', 'partially_succeeded') "
            + "AND evidence_reconcile_until > CURRENT_TIMESTAMP "
            + "AND next_action_at IS NOT NULL AND next_action_at <= CURRENT_TIMESTAMP "
            + "AND EXISTS (SELECT 1 FROM generation_job_outputs evidence_output "
            + "JOIN generation_provider_tasks evidence_task "
            + "ON evidence_task.generation_job_id = evidence_output.generation_job_id "
            + "AND evidence_task.slot_index = evidence_output.slot_index "
            + "AND evidence_task.is_delete = 0 "
            + "WHERE evidence_output.generation_job_id = generation_jobs.id "
            + "AND evidence_output.status = 'failed' AND evidence_output.is_delete = 0 "
            + "AND evidence_task.provider_task_id IS NOT NULL))) "
            + "AND (lease_expires_at IS NULL OR lease_expires_at < CURRENT_TIMESTAMP))) "
            + "ORDER BY id LIMIT 1 FOR UPDATE")
    GenerationJob selectNextWorkerJobForUpdate();

    @Select("SELECT * FROM generation_jobs WHERE id = #{id} AND is_delete = 0 FOR UPDATE")
    GenerationJob selectForUpdate(@Param("id") Long id);

    @Select("SELECT CURRENT_TIMESTAMP")
    LocalDateTime selectCurrentTime();

    @Update("UPDATE generation_jobs SET next_action_at = CURRENT_TIMESTAMP, "
            + "gmt_modified = CURRENT_TIMESTAMP WHERE id = #{id} AND type = 'video' "
            + "AND status IN ('processing', 'cancel_requested') AND is_delete = 0")
    int wakeVideoJob(@Param("id") Long id);

    @Update("UPDATE generation_jobs SET lease_expires_at = #{deadline}, "
            + "execution_deadline_at = COALESCE(execution_deadline_at, #{deadline}), "
            + "gmt_modified = CURRENT_TIMESTAMP WHERE id = #{id} AND type = 'image' "
            + "AND status = 'processing' AND version = #{version} "
            + "AND fencing_token = #{fencingToken} AND lease_owner = #{leaseOwner} "
            + "AND is_delete = 0")
    int extendImageCallLease(
            @Param("id") Long id,
            @Param("version") Integer version,
            @Param("fencingToken") Long fencingToken,
            @Param("leaseOwner") String leaseOwner,
            @Param("deadline") LocalDateTime deadline);

    /** 物理删除项目全部生成任务（生成收件箱永久删除用，绕过逻辑删除）。 */
    @Delete("DELETE FROM generation_jobs WHERE project_id = #{projectId}")
    int hardDeleteByProjectId(@Param("projectId") Long projectId);
}
