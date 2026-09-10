package com.bluewhale.worker.infrastructure.mapper;

import com.bluewhale.worker.domain.entity.GenerationJobEntity;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.LocalDateTime;

/**
 * 生成作业 Mapper（契约 §3 / 附录 B：领取与终态写入）。
 * <p>
 * SQL 逐字移植自 TS Prisma 调用，注释标注 TS 源码行号。
 */
@Mapper
public interface GenerationJobMapper extends BaseMapper<GenerationJobEntity> {

    /**
     * 领取 media_extract 作业：候选查询（claim-ops.ts:450-467）。
     * <p>
     * WHERE id = ? AND type = 'media_extract' AND is_delete = false
     *   AND next_action_at <= now
     *   AND (status = 'queued' OR (status = 'processing' AND (lease_expires_at IS NULL OR lease_expires_at < now)))
     */
    @Select("""
            SELECT * FROM generation_jobs
            WHERE id = #{jobId}
              AND type = 'media_extract'
              AND is_delete = false
              AND next_action_at <= NOW()
              AND (
                status = 'queued'
                OR (
                  status = 'processing'
                  AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
                )
              )
            ORDER BY id ASC
            LIMIT 1
            """)
    GenerationJobEntity findMediaExtractCandidate(@Param("jobId") Long jobId);

    /**
     * 领取 media_extract 作业：CAS 更新（claim-ops.ts:472-486）。
     * <p>
     * SET status='processing', lease_owner=?, lease_expires_at=now+120s,
     *     last_polled_at=now, fencing_token=fencing_token+1, version=version+1
     * WHERE id = ? AND fencing_token = ? AND status = ?
     * <p>
     * 返回受影响行数（0 = 守卫失败）。
     */
    @Update("""
            UPDATE generation_jobs
            SET status = 'processing',
                lease_owner = #{workerId},
                lease_expires_at = #{leaseExpiresAt},
                last_polled_at = NOW(),
                fencing_token = fencing_token + 1,
                version = version + 1
            WHERE id = #{jobId}
              AND fencing_token = #{fencingToken}
              AND status = #{candidateStatus}
            """)
    int claimMediaExtractCas(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("leaseExpiresAt") LocalDateTime leaseExpiresAt,
            @Param("fencingToken") Long fencingToken,
            @Param("candidateStatus") String candidateStatus
    );

    /**
     * 更新 media_extract 进度：CAS 更新 + 续租（media-extract-ops.ts:28-41）。
     * <p>
     * SET progress=clamp(0,99,round(?)), last_polled_at=now, lease_expires_at=now+120s, version=version+1
     * WHERE id = ? AND status = 'processing' AND lease_owner = ? AND fencing_token = ?
     */
    @Update("""
            UPDATE generation_jobs
            SET progress = #{progress},
                last_polled_at = NOW(),
                lease_expires_at = #{leaseExpiresAt},
                version = version + 1
            WHERE id = #{jobId}
              AND status = 'processing'
              AND lease_owner = #{workerId}
              AND fencing_token = #{fencingToken}
            """)
    int updateMediaExtractProgress(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("fencingToken") Long fencingToken,
            @Param("progress") Integer progress,
            @Param("leaseExpiresAt") LocalDateTime leaseExpiresAt
    );

    /**
     * 发布 media_extract 结果：CAS 守卫（media-extract-ops.ts:47-63）。
     * <p>
     * SET status='succeeded', progress=100, next_action_at=null, next_poll_at=null,
     *     lease_owner=null, lease_expires_at=null, version=version+1
     * WHERE id = ? AND status = 'processing' AND lease_owner = ? AND fencing_token = ?
     */
    @Update("""
            UPDATE generation_jobs
            SET status = 'succeeded',
                progress = 100,
                next_action_at = NULL,
                next_poll_at = NULL,
                lease_owner = NULL,
                lease_expires_at = NULL,
                version = version + 1
            WHERE id = #{jobId}
              AND status = 'processing'
              AND lease_owner = #{workerId}
              AND fencing_token = #{fencingToken}
            """)
    int publishMediaExtractGuard(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("fencingToken") Long fencingToken
    );

    /**
     * 发布 media_extract 结果：更新 output_asset_ids（media-extract-ops.ts:85-88）。
     */
    @Update("""
            UPDATE generation_jobs
            SET output_asset_ids = #{outputAssetIdsJson}
            WHERE id = #{jobId}
            """)
    int updateOutputAssetIds(
            @Param("jobId") Long jobId,
            @Param("outputAssetIdsJson") String outputAssetIdsJson
    );

    /**
     * 失败 media_extract 作业：CAS 守卫（media-extract-ops.ts:140-160）。
     * <p>
     * SET status='failed', error=?, next_action_at=null, next_poll_at=null,
     *     lease_owner=null, lease_expires_at=null, version=version+1
     * WHERE id = ? AND status = 'processing' AND lease_owner = ? AND fencing_token = ?
     */
    @Update("""
            UPDATE generation_jobs
            SET status = 'failed',
                error = #{errorJson},
                next_action_at = NULL,
                next_poll_at = NULL,
                lease_owner = NULL,
                lease_expires_at = NULL,
                version = version + 1
            WHERE id = #{jobId}
              AND status = 'processing'
              AND lease_owner = #{workerId}
              AND fencing_token = #{fencingToken}
            """)
    int failMediaExtractGuard(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("fencingToken") Long fencingToken,
            @Param("errorJson") String errorJson
    );
}
