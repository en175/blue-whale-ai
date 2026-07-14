package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.GenerationJob;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDateTime;

/**
 * 生成任务 Mapper：复用 MyBatis-Plus {@link BaseMapper}，扫描自 {@code config.MybatisPlusConfig}（{@code com.bluewhale.**.mapper}）。
 */
public interface GenerationJobMapper extends BaseMapper<GenerationJob> {

    @Select("SELECT * FROM generation_jobs WHERE source = 'agent_run' AND type = 'image' "
            + "AND is_delete = 0 AND (status = 'queued' "
            + "OR (status = 'processing' AND lease_expires_at < CURRENT_TIMESTAMP)) "
            + "ORDER BY id LIMIT 1 FOR UPDATE")
    GenerationJob selectNextAgentImageForUpdate();

    @Select("SELECT * FROM generation_jobs WHERE id = #{id} AND is_delete = 0 FOR UPDATE")
    GenerationJob selectForUpdate(@Param("id") Long id);

    @Select("SELECT CURRENT_TIMESTAMP")
    LocalDateTime selectCurrentTime();
}
