package com.bluewhale.worker.persistence;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;

/**
 * 生成作业日志 Mapper（契约 §3.3：终态写日志）。
 */
@Mapper
public interface GenerationJobLogMapper extends BaseMapper<GenerationJobLog> {
}
