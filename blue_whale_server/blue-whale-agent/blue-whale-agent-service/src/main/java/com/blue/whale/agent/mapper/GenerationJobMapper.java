package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.GenerationJob;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.LocalDateTime;

/**
 * 生成任务 Mapper：复用 MyBatis-Plus {@link BaseMapper}，扫描自 {@code config.MybatisPlusConfig}（{@code com.bluewhale.**.mapper}）。
 */
public interface GenerationJobMapper extends BaseMapper<GenerationJob> {

    @Select("SELECT * FROM generation_jobs WHERE source IN ('agent_run', 'bottom_dock') AND is_delete = 0 AND ("
            + "(type = 'image' AND (status = 'queued' "
            + "OR (status = 'processing' AND lease_expires_at < CURRENT_TIMESTAMP))) "
            + "OR (type = 'video' AND source = 'bottom_dock' "
            + "AND ((status IN ('queued', 'processing', 'cancel_requested') "
            + "AND (next_action_at IS NULL OR next_action_at <= CURRENT_TIMESTAMP)) "
            + "OR (status = 'failed' AND evidence_reconcile_until > CURRENT_TIMESTAMP "
            + "AND next_action_at IS NOT NULL AND next_action_at <= CURRENT_TIMESTAMP)) "
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
}
