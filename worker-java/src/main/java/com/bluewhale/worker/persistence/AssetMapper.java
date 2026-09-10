package com.bluewhale.worker.persistence;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;

/**
 * 资产 Mapper（契约 §8：资产落库）。
 */
@Mapper
public interface AssetMapper extends BaseMapper<Asset> {
}
