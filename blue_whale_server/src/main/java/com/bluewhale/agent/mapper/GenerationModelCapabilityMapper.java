package com.bluewhale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.agent.model.entity.GenerationModelCapability;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Optional;

/**
 * 模型能力 Mapper：复用 MyBatis-Plus {@link BaseMapper}，并提供按能力类型查询启用模型的快捷方法。
 */
public interface GenerationModelCapabilityMapper extends BaseMapper<GenerationModelCapability> {

    /**
     * 按能力类型查询所有启用的模型能力（含逻辑删除过滤由 MyBatis-Plus 全局配置处理）。
     */
    @Select("SELECT * FROM generation_model_capability "
            + "WHERE capability_type = #{capabilityType} AND enabled = 1 AND is_delete = 0")
    List<GenerationModelCapability> selectEnabledByCapabilityType(@Param("capabilityType") String capabilityType);

    /**
     * 按 model_id 查询启用的模型能力。
     */
    @Select("SELECT * FROM generation_model_capability "
            + "WHERE model_id = #{modelId} AND enabled = 1 AND is_delete = 0 LIMIT 1")
    Optional<GenerationModelCapability> selectEnabledByModelId(@Param("modelId") String modelId);
}
