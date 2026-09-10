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

    // ========== 音频路径（blade-② IKCR78） ==========

    /**
     * 领取音频作业：候选查询（claim-ops.ts:395-413）。
     * <p>
     * 镜像 claimImageJobById 但不套 source 白名单（IKCR78/IKC9EJ 教训对齐 media_extract）。
     * WHERE id=? AND type='audio' AND is_delete=false AND next_action_at&lt;=now
     * AND (queued OR processing+孤儿)
     */
    @Select("""
            SELECT * FROM generation_jobs
            WHERE id = #{jobId}
              AND type = 'audio'
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
    GenerationJobEntity findAudioCandidate(@Param("jobId") Long jobId);

    /**
     * 领取音频作业：CAS 更新（claim-ops.ts:417-431）。
     * <p>
     * 与 claimMediaExtractCas 逐字一致（同 CAS 模式）。
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
    int claimAudioCas(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("leaseExpiresAt") LocalDateTime leaseExpiresAt,
            @Param("fencingToken") Long fencingToken,
            @Param("candidateStatus") String candidateStatus
    );

    // ========== 图片路径（blade-③ IKELJA） ==========

    /**
     * 领取图片作业：候选查询（claim-ops.ts:335-354）。
     * <p>
     * 与 audio 不同：图片套 source 白名单（:339 source IN CLAIMABLE_JOB_SOURCES）。
     * CLAIMABLE_JOB_SOURCES = ['bottom_dock','plan_apply','storyboard_preview']
     * （-internals.ts:12-16）。
     */
    @Select("""
            SELECT * FROM generation_jobs
            WHERE id = #{jobId}
              AND type = 'image'
              AND source IN ('bottom_dock', 'plan_apply', 'storyboard_preview')
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
    GenerationJobEntity findImageCandidate(@Param("jobId") Long jobId);

    /**
     * 领取图片作业：CAS 更新（claim-ops.ts:358-372）。
     * <p>
     * 与 claimAudioCas 逐字一致（同 CAS 模式）。
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
    int claimImageCas(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("leaseExpiresAt") LocalDateTime leaseExpiresAt,
            @Param("fencingToken") Long fencingToken,
            @Param("candidateStatus") String candidateStatus
    );

    /**
     * 瞬态重试：图片作业回 queued（claim-ops.ts:561-578 requeueImageJobForRetry）。
     * <p>
     * WHERE id=? AND status='processing'（无 fence 入参——与 TS 逐字一致）。
     * SET status='queued', lease_owner=null, lease_expires_at=null,
     *     next_action_at=?, retry_count+1, fencing_token+1, version+1
     */
    @Update("""
            UPDATE generation_jobs
            SET status = 'queued',
                lease_owner = NULL,
                lease_expires_at = NULL,
                next_action_at = #{nextActionAt},
                retry_count = retry_count + 1,
                fencing_token = fencing_token + 1,
                version = version + 1
            WHERE id = #{jobId}
              AND status = 'processing'
            """)
    int requeueImageCas(
            @Param("jobId") Long jobId,
            @Param("nextActionAt") LocalDateTime nextActionAt
    );

    // ========== 通用终态写入（settle-ops.ts:53-206 / 233-336） ==========

    /**
     * completeJob CAS 守卫（settle-ops.ts:65-77）。
     * <p>
     * SET status='succeeded', progress=100, output_asset_ids=?, next_action_at=null,
     *     lease_owner=null, lease_expires_at=null, version=version+1
     * WHERE id=? AND status='processing' AND lease_owner=? AND fencing_token=?
     */
    @Update("""
            UPDATE generation_jobs
            SET status = 'succeeded',
                progress = 100,
                output_asset_ids = #{outputAssetIdsJson},
                next_action_at = NULL,
                lease_owner = NULL,
                lease_expires_at = NULL,
                version = version + 1
            WHERE id = #{jobId}
              AND status = 'processing'
              AND lease_owner = #{workerId}
              AND fencing_token = #{fencingToken}
            """)
    int completeJobGuard(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("fencingToken") Long fencingToken,
            @Param("outputAssetIdsJson") String outputAssetIdsJson
    );

    /**
     * completeJob 槽位聚合后修正状态（settle-ops.ts:116-121）。
     * 仅当聚合态 ≠ 'succeeded' 时调用（partially_succeeded / failed）。
     */
    @Update("""
            UPDATE generation_jobs
            SET status = #{finalStatus}
            WHERE id = #{jobId}
            """)
    int updateJobStatus(@Param("jobId") Long jobId, @Param("finalStatus") String finalStatus);

    /**
     * failJob CAS 守卫（settle-ops.ts:238-253）。
     * <p>
     * SET status='failed', error=?, next_action_at=null,
     *     lease_owner=null, lease_expires_at=null, version=version+1
     * WHERE id=? AND status='processing' AND lease_owner=? AND fencing_token=?
     */
    @Update("""
            UPDATE generation_jobs
            SET status = 'failed',
                error = #{errorJson},
                next_action_at = NULL,
                lease_owner = NULL,
                lease_expires_at = NULL,
                version = version + 1
            WHERE id = #{jobId}
              AND status = 'processing'
              AND lease_owner = #{workerId}
              AND fencing_token = #{fencingToken}
            """)
    int failJobGuard(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("fencingToken") Long fencingToken,
            @Param("errorJson") String errorJson
    );

    /**
     * createAsset fence CAS 守卫（asset-ops.ts:156-165）。
     * <p>
     * 用 version 自增做无业务副作用的原子占位（不改 status，job 仍是 processing）。
     * count≠1 即 stale worker，返回 0。
     */
    @Update("""
            UPDATE generation_jobs
            SET version = version + 1
            WHERE id = #{jobId}
              AND status = 'processing'
              AND lease_owner = #{workerId}
              AND fencing_token = #{fencingToken}
            """)
    int createAssetGuard(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("fencingToken") Long fencingToken
    );

    // ========== 视频路径（blade-④ IKEL9A） ==========

    /**
     * 领取视频作业：候选查询（claim-ops.ts:261-290 视频 source 白名单）。
     * <p>
     * 视频 source 白名单 = [bottom_dock, plan_apply, plan, scene_card]（契约 §2）。
     * WHERE id=? AND type='video' AND source IN 白名单 AND is_delete=false
     * AND next_action_at&lt;=now AND (queued OR processing+孤儿)
     */
    @Select("""
            SELECT * FROM generation_jobs
            WHERE id = #{jobId}
              AND type = 'video'
              AND source IN ('bottom_dock', 'plan_apply', 'plan', 'scene_card')
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
    GenerationJobEntity findVideoCandidate(@Param("jobId") Long jobId);

    /**
     * 领取视频作业：CAS 更新（claim-ops.ts:295-315）。
     * <p>
     * 与 claimAudioCas 逐字一致（同 CAS 模式）。
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
    int claimVideoCas(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("leaseExpiresAt") LocalDateTime leaseExpiresAt,
            @Param("fencingToken") Long fencingToken,
            @Param("candidateStatus") String candidateStatus
    );

    /**
     * 标记视频已提交（video-ops.ts:14-35 markVideoSubmitted 逐字）。
     * <p>
     * 评审修复 C1：补 provider='new-api'、progress=1、next_poll_at；
     * **去掉 fencing_token+1**（TS 不 bump——fence 只在 claim/requeue 递增，契约 §3.1）。
     * 时刻值由 Java 计算传入（原 DATE_ADD ... MILLISECOND 为非法 MySQL 单位，潜伏语法炸点）。
     * 金标 G09 pin 全 SET 列。
     */
    @Update("""
            UPDATE generation_jobs
            SET provider = 'new-api',
                provider_task_id = #{providerTaskId},
                progress = 1,
                next_poll_at = #{nextPollAt},
                next_action_at = #{nextPollAt},
                lease_owner = NULL,
                lease_expires_at = NULL,
                version = version + 1
            WHERE id = #{jobId}
              AND status = 'processing'
              AND lease_owner = #{workerId}
              AND fencing_token = #{fencingToken}
            """)
    int markVideoSubmitted(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("fencingToken") Long fencingToken,
            @Param("providerTaskId") String providerTaskId,
            @Param("nextPollAt") java.time.LocalDateTime nextPollAt
    );

    /**
     * 重排视频轮询（video-ops.ts:37-58 rescheduleVideoPoll 逐字）。
     * <p>
     * 评审修复 C2：progress 由 service 端钳制（Math.max(0,Math.min(99,round))）后传入；
     * 补 last_polled_at、next_poll_at；**去掉 fencing_token+1**（TS 不 bump）。
     * 时刻值 Java 计算（原 DATE_ADD MILLISECOND 非法语法一并消除）。金标 G10 pin 全列。
     */
    @Update("""
            UPDATE generation_jobs
            SET poll_count = COALESCE(poll_count, 0) + 1,
                progress = #{progress},
                last_polled_at = #{now},
                next_poll_at = #{nextPollAt},
                next_action_at = #{nextPollAt},
                lease_owner = NULL,
                lease_expires_at = NULL,
                version = version + 1
            WHERE id = #{jobId}
              AND status = 'processing'
              AND lease_owner = #{workerId}
              AND fencing_token = #{fencingToken}
            """)
    int rescheduleVideoPoll(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("fencingToken") Long fencingToken,
            @Param("progress") Integer progress,
            @Param("now") java.time.LocalDateTime now,
            @Param("nextPollAt") java.time.LocalDateTime nextPollAt
    );

    /**
     * 发布视频结果 CAS 守卫（video-ops.ts:60-100 publishVideoResult）。
     * <p>
     * SET status='succeeded', progress=100, next_action_at=null,
     *     lease_owner=null, lease_expires_at=null, version+1
     * WHERE id=? AND status='processing' AND lease_owner=? AND fencing_token=?
     * <p>
     * <b>修正一</b>：actual_amount_fen 不在范围（settle 段整体省略）。
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
    int publishVideoGuard(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("fencingToken") Long fencingToken
    );

    /**
     * 失败视频作业 CAS 守卫（video-ops.ts:200-260 failVideoJob）。
     * <p>
     * 与 failJobGuard 逐字一致（同 CAS 模式），视频复用通用 fail 守卫。
     * <p>
     * <b>修正一</b>：release_note 不在范围（release 段整体省略）。
     */
    /**
     * 失败视频作业 CAS 守卫（video-ops.ts:209-221 failVideoJob 独立 SQL）。
     * 与通用 failJobGuard 的差异（逐字核对后单独成条，评审修复）：
     * 视频版多 `next_poll_at = NULL`（:217）。release_note/预留段按修正一省略。
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
    int failVideoGuard(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("fencingToken") Long fencingToken,
            @Param("errorJson") String errorJson
    );

    /**
     * 取消视频作业（video-ops.ts:306-343 cancelVideoBeforeDispatch）。
     * <p>
     * WHERE id=? AND status='processing' AND lease_owner=? AND fencing_token=?
     *       AND provider_task_id IS NULL（未提交上游才可取消，契约 §3.3）
     * <p>
     * SET status='cancelled', progress=0, next_action_at=null,
     *     lease_owner=null, lease_expires_at=null, version+1
     * <p>
     * <b>修正一</b>：release refund_confirmed 段整体省略。
     */
    @Update("""
            UPDATE generation_jobs
            SET status = 'cancelled',
                progress = 0,
                next_action_at = NULL,
                next_poll_at = NULL,
                lease_owner = NULL,
                lease_expires_at = NULL,
                version = version + 1
            WHERE id = #{jobId}
              AND status = 'processing'
              AND lease_owner = #{workerId}
              AND fencing_token = #{fencingToken}
              AND provider_task_id IS NULL
            """)
    int cancelVideoBeforeDispatch(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("fencingToken") Long fencingToken
    );

    /**
     * 按 id 查 provider_task_id（IKEA26 parent-reuse 用：retry job 查父 job 的上游 task）。
     */
    @Select("""
            SELECT provider_task_id FROM generation_jobs WHERE id = #{jobId}
            """)
    String findProviderTaskId(@Param("jobId") Long jobId);
}
