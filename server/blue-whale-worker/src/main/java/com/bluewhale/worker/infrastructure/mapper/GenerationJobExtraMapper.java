package com.bluewhale.worker.infrastructure.mapper;

import com.bluewhale.worker.domain.entity.GenerationJobExtraEntity;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface GenerationJobExtraMapper extends BaseMapper<GenerationJobExtraEntity> {

    @Select("""
            SELECT * FROM generation_job_extras
            WHERE generation_job_id = #{jobId}
            """)
    List<GenerationJobExtraEntity> findByJobId(@Param("jobId") Long jobId);

    @Select("""
            <script>
            SELECT * FROM generation_job_extras
            WHERE generation_job_id IN
            <foreach collection="jobIds" item="item" open="(" separator="," close=")">#{item}</foreach>
            </script>
            """)
    List<GenerationJobExtraEntity> findByJobIds(@Param("jobIds") List<Long> jobIds);

    @Insert("""
            INSERT INTO generation_job_extras
                (generation_job_id, extra_key, value_type, value_text, gmt_create, gmt_modified)
            VALUES
                (#{jobId}, #{extraKey}, #{valueType}, #{valueText}, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                value_type = VALUES(value_type),
                value_text = VALUES(value_text),
                gmt_modified = NOW()
            """)
    int upsert(
            @Param("jobId") Long jobId,
            @Param("extraKey") String extraKey,
            @Param("valueType") String valueType,
            @Param("valueText") String valueText
    );
}
