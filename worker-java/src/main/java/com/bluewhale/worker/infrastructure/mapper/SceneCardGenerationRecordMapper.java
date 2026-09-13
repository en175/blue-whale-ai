package com.bluewhale.worker.infrastructure.mapper;

import com.bluewhale.worker.domain.entity.SceneCardGenerationRecordEntity;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

/**
 * 场景卡生成记录 Mapper（generation-worker-internals.ts:21-62 syncRecordSummary）。
 */
@Mapper
public interface SceneCardGenerationRecordMapper extends BaseMapper<SceneCardGenerationRecordEntity> {

    /**
     * 更新 summary_status + version+1（internals.ts:47-49）。
     * <p>
     * SET summary_status=?, version=version+1 WHERE id=?
     */
    @Update("""
            UPDATE scene_card_generation_records
            SET summary_status = #{summaryStatus},
                version = version + 1
            WHERE id = #{recordId}
            """)
    int updateSummaryStatus(
            @Param("recordId") Long recordId,
            @Param("summaryStatus") String summaryStatus
    );
}
