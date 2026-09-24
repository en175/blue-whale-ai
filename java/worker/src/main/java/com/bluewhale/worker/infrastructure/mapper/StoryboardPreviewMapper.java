package com.bluewhale.worker.infrastructure.mapper;

import com.bluewhale.worker.domain.entity.StoryboardPreviewEntity;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * 故事板预览 Mapper（generation-worker-internals.ts:67-113 syncStoryboardPreviewSummary）。
 */
@Mapper
public interface StoryboardPreviewMapper extends BaseMapper<StoryboardPreviewEntity> {

    /**
     * 按 first_generation_job_id 反查预览（internals.ts:71-74）。
     * <p>
     * WHERE first_generation_job_id=? AND is_delete=0
     * <p>
     * storyboard_previews.is_delete 为 INT 0/1（与 assets 的 BOOLEAN 不同）。
     */
    @Select("""
            SELECT id, project_id, version
            FROM storyboard_previews
            WHERE first_generation_job_id = #{jobId}
              AND is_delete = 0
            LIMIT 1
            """)
    StoryboardPreviewEntity findByFirstGenerationJobId(@Param("jobId") Long jobId);

    /**
     * 更新 summary_status + version+1（internals.ts:98-100）。
     */
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
