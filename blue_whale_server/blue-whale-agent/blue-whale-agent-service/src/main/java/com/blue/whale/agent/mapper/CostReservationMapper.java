package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.CostReservation;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDateTime;

public interface CostReservationMapper extends BaseMapper<CostReservation> {

    @Select("SELECT * FROM cost_reservations WHERE generation_job_id = #{jobId} FOR UPDATE")
    CostReservation selectByJobForUpdate(@Param("jobId") Long jobId);

    @Select("SELECT * FROM cost_reservations WHERE generation_job_id = #{jobId}")
    CostReservation selectByJob(@Param("jobId") Long jobId);

    @Select("SELECT CURRENT_TIMESTAMP")
    LocalDateTime selectCurrentTime();

    @Select("SELECT COALESCE(SUM(CASE WHEN status = 'SETTLED' "
            + "THEN actual_amount_fen ELSE reserved_amount_fen END), 0) "
            + "FROM cost_reservations WHERE project_id = #{projectId} "
            + "AND status IN ('ACTIVE', 'PENDING_RECONCILIATION', 'SETTLED') "
            + "AND gmt_create >= #{since}")
    long sumProjectSince(@Param("projectId") Long projectId, @Param("since") LocalDateTime since);

    @Select("SELECT COALESCE(SUM(CASE WHEN status = 'SETTLED' "
            + "THEN actual_amount_fen ELSE reserved_amount_fen END), 0) "
            + "FROM cost_reservations WHERE user_id = #{userId} "
            + "AND status IN ('ACTIVE', 'PENDING_RECONCILIATION', 'SETTLED') "
            + "AND gmt_create >= #{since}")
    long sumUserSince(@Param("userId") Long userId, @Param("since") LocalDateTime since);

    @Select("SELECT COALESCE(SUM(CASE WHEN status = 'SETTLED' "
            + "THEN actual_amount_fen ELSE reserved_amount_fen END), 0) "
            + "FROM cost_reservations WHERE provider = #{provider} "
            + "AND status IN ('ACTIVE', 'PENDING_RECONCILIATION', 'SETTLED') "
            + "AND gmt_create >= #{since}")
    long sumProviderSince(@Param("provider") String provider, @Param("since") LocalDateTime since);

    @Select("SELECT COALESCE(SUM(CASE WHEN status = 'SETTLED' "
            + "THEN actual_amount_fen ELSE reserved_amount_fen END), 0) "
            + "FROM cost_reservations WHERE status IN ('ACTIVE', 'PENDING_RECONCILIATION', 'SETTLED') "
            + "AND gmt_create >= #{since}")
    long sumGlobalSince(@Param("since") LocalDateTime since);
}
