package com.bluewhale.billing.infrastructure.persistence.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.billing.infrastructure.persistence.po.PricingCatalogEntity;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface PricingCatalogMapper extends BaseMapper<PricingCatalogEntity> {

    PricingCatalogEntity selectActive();

    int selectMaxVersion();
}
