package com.bluewhale.billing.infrastructure.persistence.mapper;

import org.apache.ibatis.annotations.Mapper;
import com.bluewhale.billing.infrastructure.persistence.row.UserImbalanceRow;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface ReconciliationMapper {

    long sumLotsRemaining();

    long sumLedgerBalance();

    List<UserImbalanceRow> imbalancedUsers(@Param("limit") int limit);
}
