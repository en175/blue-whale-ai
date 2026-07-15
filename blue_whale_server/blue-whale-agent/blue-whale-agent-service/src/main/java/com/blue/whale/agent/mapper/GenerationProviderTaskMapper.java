package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.GenerationProviderTask;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

public interface GenerationProviderTaskMapper extends BaseMapper<GenerationProviderTask> {

    @Select("SELECT * FROM generation_provider_tasks WHERE generation_job_id = #{jobId} " +
            "AND is_delete = 0 FOR UPDATE")
    GenerationProviderTask selectByJobForUpdate(@Param("jobId") Long jobId);

    @Select("SELECT * FROM generation_provider_tasks WHERE generation_job_id = #{jobId} " +
            "AND is_delete = 0")
    GenerationProviderTask selectByJob(@Param("jobId") Long jobId);
}
