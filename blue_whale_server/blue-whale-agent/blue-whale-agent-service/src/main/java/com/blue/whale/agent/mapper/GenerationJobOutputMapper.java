package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.GenerationJobOutput;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

public interface GenerationJobOutputMapper extends BaseMapper<GenerationJobOutput> {

    @Select("SELECT * FROM generation_job_outputs "
            + "WHERE generation_job_id = #{jobId} AND slot_index = #{slotIndex} "
            + "AND is_delete = 0 FOR UPDATE")
    GenerationJobOutput selectForUpdate(
            @Param("jobId") Long jobId,
            @Param("slotIndex") int slotIndex);
}
