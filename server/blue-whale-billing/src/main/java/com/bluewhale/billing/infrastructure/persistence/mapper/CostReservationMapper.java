package com.bluewhale.billing.infrastructure.persistence.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.billing.infrastructure.persistence.po.CostReservationEntity;
import com.bluewhale.billing.infrastructure.persistence.row.StaleReservationRow;
import com.bluewhale.billing.infrastructure.persistence.row.UserAmountRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface CostReservationMapper extends BaseMapper<CostReservationEntity> {

    CostReservationEntity lockByJobId(@Param("jobId") long jobId);

    int markSettled(@Param("jobId") long jobId,
                    @Param("actualCredits") long actualCredits,
                    @Param("receivableCredits") long receivableCredits);

    int markReleased(@Param("jobId") long jobId, @Param("releaseNote") String releaseNote);

    long sumSettledActualCredits(@Param("from") LocalDateTime from,
                                 @Param("to") LocalDateTime to);

    List<UserAmountRow> sumSettledActualByUser(@Param("userIds") List<Long> userIds);

    List<StaleReservationRow> listStaleHeld(@Param("seconds") long seconds,
                                            @Param("limit") int limit);
}
