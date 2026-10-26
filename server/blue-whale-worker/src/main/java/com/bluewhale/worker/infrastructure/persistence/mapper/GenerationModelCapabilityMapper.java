package com.bluewhale.worker.infrastructure.persistence.mapper;

import com.bluewhale.worker.domain.entity.GenerationModelCapabilityEntity;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface GenerationModelCapabilityMapper extends BaseMapper<GenerationModelCapabilityEntity> {

    @Select("""
            SELECT * FROM generation_model_capability
            WHERE model_id = #{modelId}
              AND enabled = true
              AND is_delete = false
            LIMIT 1
            """)
    GenerationModelCapabilityEntity findByModelId(@Param("modelId") String modelId);
}
