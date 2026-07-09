package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.GenerationJob;

/**
 * 生成任务 Mapper：复用 MyBatis-Plus {@link BaseMapper}，扫描自 {@code config.MybatisPlusConfig}（{@code com.bluewhale.**.mapper}）。
 */
public interface GenerationJobMapper extends BaseMapper<GenerationJob> {
}
