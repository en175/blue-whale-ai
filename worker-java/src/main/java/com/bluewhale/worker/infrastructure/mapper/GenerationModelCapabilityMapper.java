package com.bluewhale.worker.infrastructure.mapper;

import com.bluewhale.worker.domain.entity.GenerationModelCapabilityEntity;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * 生成模型能力 Mapper（asset-ops.ts:103-149 findImageCapability）。
 */
@Mapper
public interface GenerationModelCapabilityMapper extends BaseMapper<GenerationModelCapabilityEntity> {

    /**
     * 查询模型能力行（asset-ops.ts:104-106）。
     * <p>
     * WHERE model_id=? AND enabled=true AND is_delete=false
     * <p>
     * 与 TS Prisma findFirst 逐字一致。返回 null = 模型不受支持（model_unavailable）。
     */
    @Select("""
            SELECT * FROM generation_model_capability
            WHERE model_id = #{modelId}
              AND enabled = true
              AND is_delete = false
            LIMIT 1
            """)
    GenerationModelCapabilityEntity findByModelId(@Param("modelId") String modelId);
}
