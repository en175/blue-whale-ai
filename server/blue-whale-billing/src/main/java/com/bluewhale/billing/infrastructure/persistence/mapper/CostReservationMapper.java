package com.bluewhale.billing.infrastructure.persistence.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.billing.infrastructure.persistence.po.CostReservationEntity;
import com.bluewhale.billing.infrastructure.persistence.row.UserAmountRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface CostReservationMapper extends BaseMapper<CostReservationEntity> {

    CostReservationEntity lockByJobId(@Param("jobId") long jobId);

    int markRefunded(@Param("jobId") long jobId, @Param("releaseNote") String releaseNote);

    long sumChargedCredits(@Param("from") LocalDateTime from,
                           @Param("to") LocalDateTime to);

    List<UserAmountRow> sumChargedByUser(@Param("userIds") List<Long> userIds);
}
