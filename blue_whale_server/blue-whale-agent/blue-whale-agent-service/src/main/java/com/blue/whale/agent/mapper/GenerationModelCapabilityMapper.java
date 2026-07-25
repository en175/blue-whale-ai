package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.model.entity.GenerationModelCapability;

import java.util.List;
import java.util.Optional;

/**
 * 模型能力 Mapper：复用 MyBatis-Plus {@link BaseMapper}，并提供按能力类型/model_id 查询启用模型的快捷方法。
 *
 * <p><b>必须用 BaseMapper 的 wrapper 方法（selectList/selectOne），不要用自定义 @Select。</b>
 * 实体上的 {@code autoResultMap=true} 只对 MP 内置方法生效，JSON 字段（supportedSizes/features 等）
 * 才会经 {@code JacksonTypeHandler} 正确反序列化；自定义 {@code @Select} 不走 autoResultMap，
 * JSON 字段会读成 null（曾导致“模型未配置可用尺寸”）。
 * 逻辑删除由 {@code BaseEntity} 的 {@code @TableLogic(is_delete)} 自动过滤。
 */
public interface GenerationModelCapabilityMapper extends BaseMapper<GenerationModelCapability> {

    /**
     * 按能力类型查询所有启用的模型能力。
     */
    default List<GenerationModelCapability> selectEnabledByCapabilityType(String capabilityType) {
        return selectList(Wrappers.<GenerationModelCapability>lambdaQuery()
                .eq(GenerationModelCapability::getCapabilityType, capabilityType)
                .eq(GenerationModelCapability::getEnabled, true));
    }

    /**
     * 按 model_id 查询启用的模型能力（LIMIT 1，取第一条）。
     */
    default Optional<GenerationModelCapability> selectEnabledByModelId(String modelId) {
        return selectList(Wrappers.<GenerationModelCapability>lambdaQuery()
                .eq(GenerationModelCapability::getModelId, modelId)
                .eq(GenerationModelCapability::getEnabled, true)
                .last("LIMIT 1"))
                .stream()
                .findFirst();
    }
}
