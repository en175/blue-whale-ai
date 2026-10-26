package com.bluewhale.billing.infrastructure.persistence.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.billing.infrastructure.persistence.po.LedgerEntryEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface LedgerEntryMapper extends BaseMapper<LedgerEntryEntity> {

    Long latestBalanceForUpdate(@Param("userId") long userId, @Param("account") String account);

    Long latestBalance(@Param("userId") long userId, @Param("account") String account);

    List<LedgerEntryEntity> listRecentForAudit(@Param("userId") long userId,
                                              @Param("limit") int limit);
}
