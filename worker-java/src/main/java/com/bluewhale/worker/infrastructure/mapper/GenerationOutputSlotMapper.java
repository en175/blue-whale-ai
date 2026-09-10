package com.bluewhale.worker.infrastructure.mapper;

import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

/**
 * 生成输出槽 Mapper（settle-ops.ts:79-121 槽位聚合）。
 */
@Mapper
public interface GenerationOutputSlotMapper extends BaseMapper<GenerationOutputSlotEntity> {

    /**
     * 查任务全部槽位，按 slot_index asc（settle-ops.ts:79-82）。
     */
    @Select("""
            SELECT * FROM generation_output_slots
            WHERE generation_job_id = #{jobId}
            ORDER BY slot_index ASC
            """)
    List<GenerationOutputSlotEntity> findByJobId(@Param("jobId") Long jobId);

    /**
     * 查任务 pending 态槽位（failJob 路径，settle-ops.ts:255-257）。
     */
    @Select("""
            SELECT * FROM generation_output_slots
            WHERE generation_job_id = #{jobId}
              AND status = 'pending'
            """)
    List<GenerationOutputSlotEntity> findPendingByJobId(@Param("jobId") Long jobId);

    /**
     * 更新槽位状态 + 绑定 asset_id（settle-ops.ts:88-92）。
     */
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

    /**
     * 更新槽位状态（无 asset_id，settle-ops.ts:98-101 / 258-261）。
     */
    @Update("""
            UPDATE generation_output_slots
            SET status = #{status}
            WHERE id = #{slotId}
            """)
    int updateSlotStatus(@Param("slotId") Long slotId, @Param("status") String status);
}
