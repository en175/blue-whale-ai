package com.bluewhale.billing.infrastructure.persistence.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.billing.infrastructure.persistence.po.MemberDiscountEntity;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface MemberDiscountMapper extends BaseMapper<MemberDiscountEntity> {
}
