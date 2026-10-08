package com.bluewhale.billing.adapter.outbound.persistence.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.billing.adapter.outbound.persistence.entity.MemberDiscountEntity;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface MemberDiscountMapper extends BaseMapper<MemberDiscountEntity> {
}
