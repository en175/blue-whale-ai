package com.bluewhale.worker.infrastructure.mapper;

import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

@Mapper
public interface GenerationOutputSlotMapper extends BaseMapper<GenerationOutputSlotEntity> {

    @Select("""
            SELECT * FROM generation_output_slots
            WHERE generation_job_id = #{jobId}
            ORDER BY slot_index ASC
            """)
    List<GenerationOutputSlotEntity> findByJobId(@Param("jobId") Long jobId);

    @Select("""
            SELECT * FROM generation_output_slots
            WHERE generation_job_id = #{jobId}
              AND status = 'pending'
            """)
    List<GenerationOutputSlotEntity> findPendingByJobId(@Param("jobId") Long jobId);

    @Update("""
            UPDATE generation_output_slots
            SET status = #{status}, asset_id = #{assetId}
            WHERE id = #{slotId}
            """)
    int updateSlot(
            @Param("slotId") Long slotId,
            @Param("status") String status,
            @Param("assetId") Long assetId
    );

    @Update("""
            UPDATE generation_output_slots
            SET status = #{status}
            WHERE id = #{slotId}
            """)
    int updateSlotStatus(@Param("slotId") Long slotId, @Param("status") String status);

    @Select("""
            SELECT * FROM generation_output_slots
            WHERE scene_card_generation_record_id = #{recordId}
            ORDER BY id ASC
            """)
    List<GenerationOutputSlotEntity> findBySceneCardRecordId(@Param("recordId") Long recordId);
}
