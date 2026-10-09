package com.bluewhale.worker.infrastructure.persistence.mapper;

import com.bluewhale.worker.domain.entity.StoryboardPreviewEntity;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface StoryboardPreviewMapper extends BaseMapper<StoryboardPreviewEntity> {

    @Select("""
            SELECT id, project_id, version
            FROM storyboard_previews
            WHERE first_generation_job_id = #{jobId}
              AND is_delete = 0
            LIMIT 1
            """)
    StoryboardPreviewEntity findByFirstGenerationJobId(@Param("jobId") Long jobId);

    @Update("""
            UPDATE storyboard_previews
            SET summary_status = #{summaryStatus},
                version = version + 1
            WHERE id = #{previewId}
            """)
    int updateSummaryStatus(
            @Param("previewId") Long previewId,
            @Param("summaryStatus") String summaryStatus
    );
}
