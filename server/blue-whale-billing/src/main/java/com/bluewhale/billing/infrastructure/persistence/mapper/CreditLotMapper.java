package com.bluewhale.billing.infrastructure.persistence.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.billing.infrastructure.persistence.po.CreditLotEntity;
import com.bluewhale.billing.infrastructure.persistence.row.SourceAvailableRow;
import com.bluewhale.billing.infrastructure.persistence.row.UserAmountRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface CreditLotMapper extends BaseMapper<CreditLotEntity> {

    List<CreditLotEntity> lockActiveLots(@Param("userId") long userId);

    long sumAvailable(@Param("userId") long userId);

    List<SourceAvailableRow> sumAvailableBySource(@Param("userId") long userId);

    List<UserAmountRow> sumAvailableByUser(@Param("userIds") List<Long> userIds);

    List<UserAmountRow> sumGrantedByUser(@Param("userIds") List<Long> userIds,
                                         @Param("source") String source);

    List<CreditLotEntity> listDueLots(@Param("limit") int limit);

    CreditLotEntity lockById(@Param("lotId") long lotId);

    int expireLot(@Param("lotId") long lotId, @Param("amount") long amount);

    List<CreditLotEntity> listExpiring(@Param("userId") long userId,
                                       @Param("limit") int limit);

    List<CreditLotEntity> listUserLots(@Param("userId") long userId,
                                       @Param("createdFrom") LocalDateTime createdFrom,
                                       @Param("createdTo") LocalDateTime createdTo,
                                       @Param("offset") long offset,
                                       @Param("limit") int limit);

    long countUserLots(@Param("userId") long userId,
                       @Param("createdFrom") LocalDateTime createdFrom,
                       @Param("createdTo") LocalDateTime createdTo);

    int consume(@Param("lotId") long lotId, @Param("amount") long amount);

    int restore(@Param("lotId") long lotId, @Param("amount") long amount);
}
