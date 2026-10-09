package com.bluewhale.worker.infrastructure.persistence.mapper;

import com.bluewhale.worker.domain.entity.SceneCardGenerationRecordEntity;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface SceneCardGenerationRecordMapper extends BaseMapper<SceneCardGenerationRecordEntity> {

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
