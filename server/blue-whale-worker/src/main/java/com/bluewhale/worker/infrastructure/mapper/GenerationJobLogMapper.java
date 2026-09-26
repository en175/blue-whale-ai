package com.bluewhale.worker.infrastructure.mapper;

import com.bluewhale.worker.domain.entity.GenerationJobLogEntity;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;

/**
 * 生成作业日志 Mapper（契约 §3.3：终态写日志）。
 */
@Mapper
public interface GenerationJobLogMapper extends BaseMapper<GenerationJobLogEntity> {
}
