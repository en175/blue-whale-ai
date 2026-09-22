package com.bluewhale.worker.infrastructure.mapper;

import com.bluewhale.worker.domain.contract.VideoEnhanceContract;
import com.bluewhale.worker.domain.contract.VideoFrameInterpolationContract;
import com.bluewhale.worker.domain.contract.VideoSubtitleEraseContract;
import com.bluewhale.worker.domain.contract.VocalSplitContract;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.LocalDateTime;
import java.util.List;

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
     * 更新 video_scene_split 进度：CAS 更新 + 续租（IKH8BP 审查修复；SQL 语义与
     * updateMediaExtractProgress 同款，仅租约时长由调用侧按场景切分的单段转存窗口传入）。
     * <p>
     * SET progress=clamp(0,99,round(?)), last_polled_at=now, lease_expires_at=?, version=version+1
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
    int updateVideoSceneSplitProgress(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("fencingToken") Long fencingToken,
            @Param("progress") Integer progress,
            @Param("leaseExpiresAt") LocalDateTime leaseExpiresAt
    );

    /**
     * 更新 video_matting 进度：CAS 更新 + 续租（IKHK99；updateVideoSceneSplitProgress 的
     * 单产物形态——completed 相结果转存前的心跳续租通道，租约时长由调用侧传入）。
     * <p>
     * SET progress=clamp(0,99,round(?)), last_polled_at=now, lease_expires_at=?, version=version+1
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
    int updateVideoMattingProgress(
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
    int publishResultGuard(
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

    // ========== 音频截取路径（IKHPK9） ==========

    /**
     * 领取 audio_trim 作业：候选查询（不套 source 白名单，对齐 findAudioCandidate /
     * findMediaExtractCandidate）。
     * <p>
     * 与图片路径的参数化 {@code findCandidateByTypeAndSources} 不同，本方法**不拼接 source
     * 条件**：audio_trim 的唯一创建入口落库 {@code source='dock'}，但按 IKCR78 / IKC9EJ
     * 教训，套白名单会漏掉非预期来源的真卡任务。
     * <p>
     * 此前实现传 {@code List.of()} 给参数化方法来表达同一语义，而 MyBatis 对空集合
     * **什么都不输出**（连 open / close 都不输出），渲染出
     * {@code ... AND source IN       AND is_delete = false ...} 的坏 SQL，claim 恒抛
     * 语法错误，任务永久卡 queued（IKHPK9）。专属查询是「不套白名单」在本仓的既有表达方式。
     * <p>
     * WHERE id=? AND type='audio_trim' AND is_delete=false AND next_action_at&lt;=now
     * AND (queued OR processing+孤儿)
     */
    @Select("""
            SELECT * FROM generation_jobs
            WHERE id = #{jobId}
              AND type = 'audio_trim'
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
    GenerationJobEntity findAudioTrimCandidate(@Param("jobId") Long jobId);

    // ========== 图片路径（blade-③ IKELJA） ==========

    /**
     * 按媒体类型 + source 白名单领取候选（claim-ops.ts:335-354 的参数化通用形态）。
     * <p>
     * image 路径：type='image'，source 白名单 = CLAIMABLE_JOB_SOURCES
     * ['bottom_dock','plan_apply','storyboard_preview']（-internals.ts:12-16）；
     * image_enhance 路径（契约 §14）：type='image_enhance'，白名单单源 ['image_enhance']
     * （唯一创建入口 = 画布图片卡工具条，media_extract 的 source="dock" 同款专属来源值模式）。
     * 两路径仅 type / source 差异，其余条件逐字同 TS——故参数化共用，防逐字复制漂移。
     * <p>
     * ⚠️ {@code sources} **必须非空**。MyBatis 对空集合**什么都不输出**（连 {@code open} /
     * {@code close} 的括号都不输出），渲染成
     * {@code ... AND source IN       AND is_delete = false ...} 的坏 SQL → MySQL 1064。
     * 想表达「不套 source 白名单」**不要传 {@code List.of()}**，改用专属 type-only 查询：
     * {@code findMediaExtractCandidate} / {@code findAudioCandidate} /
     * {@code findAudioTrimCandidate} / {@code findVideoCandidate}（IKHPK9 教训：audio_trim 曾
     * 传空列表，claim 恒抛语法错误、recovery 无限重投，任务永久卡 queued）。
     * <p>
     * 本方法**不加** {@code <if>} 兜空：那会让「空列表 = 静默不过滤」成为隐藏语义，误传空列表时
     * source 过滤无声消失（漏真卡任务，IKC9EJ 同族风险）。
     */
    @Select("""
            <script>
            SELECT * FROM generation_jobs
            WHERE id = #{jobId}
              AND type = #{type}
              AND source IN
              <foreach collection="sources" item="item" open="(" separator="," close=")">#{item}</foreach>
              AND is_delete = false
              AND next_action_at &lt;= NOW()
              AND (
                status = 'queued'
                OR (
                  status = 'processing'
                  AND (lease_expires_at IS NULL OR lease_expires_at &lt; NOW())
                )
              )
            ORDER BY id ASC
            LIMIT 1
            </script>
            """)
    GenerationJobEntity findCandidateByTypeAndSources(
            @Param("jobId") Long jobId,
            @Param("type") String type,
            @Param("sources") List<String> sources);

    /**
     * 领取图片 / image_enhance 作业：CAS 更新（claim-ops.ts:358-372）。
     * <p>
     * CAS UPDATE 的 WHERE 只含 id / fencing_token / status，与媒体类型和 source 白名单无关，
     * 故 image 与 image_enhance（契约 §14）共用本方法；租约时长由 JobClaimService 按媒体类型传入。
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
     * 标记生成任务已提交（generation-worker-video-ops.ts markProviderSubmitted 逐字）。
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
    int markProviderSubmitted(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("fencingToken") Long fencingToken,
            @Param("providerTaskId") String providerTaskId,
            @Param("nextPollAt") java.time.LocalDateTime nextPollAt
    );

    /**
     * 重排生成任务轮询（generation-worker-video-ops.ts rescheduleProviderPoll 逐字）。
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
    int rescheduleProviderPoll(
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
     * 取消**已提交上游**的视频作业（IKHLKJ；与 {@link #cancelVideoBeforeDispatch} 同款 CAS，
     * 唯一差异 = 不带 {@code provider_task_id IS NULL} 限定）。
     * <p>
     * 语义：官方无取消端点（规格 Out of Scope：上游任务发出即不撤），故本 SQL 撤销不了上游任务，
     * 它做的是**本仓侧停止接纳该任务结果**——把 job 落到确定终态 cancelled，此后任何迟到结果都
     * 过不了 publish 守卫（{@code WHERE status='processing'}），卡片不会被复活为成功
     * （平台同款口径见 backend cancelImageJob 注释「已停止接纳本任务结果」；先生效的终态获胜）。
     * <p>
     * WHERE id=? AND status='processing' AND lease_owner=? AND fencing_token=?
     * SET status='cancelled', progress=0, next_action_at=null, next_poll_at=null,
     *     lease_owner=null, lease_expires_at=null, version+1
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
            """)
    int cancelVideoAfterDispatch(
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

    // ========== 高清放大路径（契约 §14 / IKGM9D） ==========
    // 候选查询与 CAS 均复用图片路径的参数化通用方法（findCandidateByTypeAndSources /
    // claimImageCas，见上「图片路径」段注释）：两路径仅 type / source 白名单差异，
    // CAS UPDATE 与媒体类型无关——不保留逐字复制的专属方法（审查修复 S2）。

    // ========== recovery 到点/孤儿扫描（IKF3AT；claim-ops.ts:134-230 逐字移植） ==========
    // 共同条件：is_delete=false + gmt_create 在 RECOVERY_MAX_AGE 窗口内（避免卡死任务被 60s 循环无限重放）
    // + next_action_at<=now + （queued ∨ processing 且租约空/过期——孤儿由 claim-by-id 的过期租约接管语义接走）。
    // 注：TS 的 resetStalledImageJobs 无活调用方（死代码），不移植（edits 死代码教训）。
    // 六路径仅 type / source 白名单差异（audio / media_extract 不套白名单），其余条件逐字同 TS——
    // 仿 claim 侧 findCandidateByTypeAndSources 参数化共用一份 SQL，防逐字复制漂移（IKGOQ0 审查修复）。

    /**
     * 到点/孤儿 id 扫描：按媒体类型 + 可选 source 白名单的参数化通用形态
     * （claim-ops.ts:134-230 六条同形 SQL 的收敛）。
     * <p>
     * sources 为空 → 不套 source 白名单（audio / media_extract 形态：专属来源值
     * 不在白名单，套了漏真卡任务，IKC9EJ 教训）；非空 → source IN 白名单（与该媒体类型
     * claim 候选查询同源）。
     */
    @Select("""
            <script>
            SELECT id FROM generation_jobs
            WHERE type = #{type}
            <if test="sources != null and !sources.isEmpty()">
              AND source IN
              <foreach collection="sources" item="item" open="(" separator="," close=")">#{item}</foreach>
            </if>
            AND is_delete = false
            AND gmt_create > (NOW() - INTERVAL #{maxAgeMinutes} MINUTE)
            AND next_action_at &lt;= NOW()
            AND (
              status = 'queued'
              OR (status = 'processing' AND (lease_expires_at IS NULL OR lease_expires_at &lt; NOW()))
            )
            ORDER BY id ASC
            LIMIT #{limit}
            </script>
            """)
    List<Long> listDueJobIdsByTypeAndSources(
            @Param("type") String type,
            @Param("sources") List<String> sources,
            @Param("limit") int limit,
            @Param("maxAgeMinutes") int maxAgeMinutes);

    /** 视频到点/孤儿（claim-ops.ts:134-160）：限 4 源白名单。 */
    default List<Long> listDueVideoJobIds(int limit, int maxAgeMinutes) {
        return listDueJobIdsByTypeAndSources("video",
                List.of("bottom_dock", "plan_apply", "plan", "scene_card"), limit, maxAgeMinutes);
    }

    /** 图片到点/孤儿（claim-ops.ts:163-195）：限 CLAIMABLE_JOB_SOURCES。 */
    default List<Long> listDueImageJobIds(int limit, int maxAgeMinutes) {
        return listDueJobIdsByTypeAndSources("image",
                List.of("bottom_dock", "plan_apply", "storyboard_preview"), limit, maxAgeMinutes);
    }

    /** 音频到点/孤儿（claim-ops.ts:198-230）：**不套 source 白名单**（IKC9EJ 教训，防漏捞）。 */
    default List<Long> listDueAudioJobIds(int limit, int maxAgeMinutes) {
        return listDueJobIdsByTypeAndSources("audio", List.of(), limit, maxAgeMinutes);
    }

    /** 媒体提取到点/孤儿：**不套 source 白名单**（source="dock" 不在白名单，套了漏真卡任务）。 */
    default List<Long> listDueMediaExtractJobIds(int limit, int maxAgeMinutes) {
        return listDueJobIdsByTypeAndSources("media_extract", List.of(), limit, maxAgeMinutes);
    }

    /** 音频截取到点/孤儿（IKHB6S，父单 IKHB08）：**不套 source 白名单**（claim 同形态——
     *  任务来源值随接线票定死后补录，套了漏真卡任务，IKC9EJ 教训；轮询自投消息丢失时
     *  由本扫描兜底重投，复用视频骨架语义）。 */
    default List<Long> listDueAudioTrimJobIds(int limit, int maxAgeMinutes) {
        return listDueJobIdsByTypeAndSources("audio_trim", List.of(), limit, maxAgeMinutes);
    }

    /** 高清放大到点/孤儿（契约 §14）：套 source 白名单（与 claim 同源，单源 image_enhance）。 */
    default List<Long> listDueImageEnhanceJobIds(int limit, int maxAgeMinutes) {
        return listDueJobIdsByTypeAndSources("image_enhance",
                List.of("image_enhance"), limit, maxAgeMinutes);
    }

    /** 图片擦除到点/孤儿（契约 §15）：套 source 白名单（与 claim 同源，单源 image_erase）。 */
    default List<Long> listDueImageEraseJobIds(int limit, int maxAgeMinutes) {
        return listDueJobIdsByTypeAndSources("image_erase",
                List.of("image_erase"), limit, maxAgeMinutes);
    }

    /** 智能扩图到点/孤儿（IKGOQW）：套 source 白名单（与 claim 同源，单源 image_outpaint）。 */
    default List<Long> listDueImageOutpaintJobIds(int limit, int maxAgeMinutes) {
        return listDueJobIdsByTypeAndSources("image_outpaint",
                List.of("image_outpaint"), limit, maxAgeMinutes);
    }

    /** 图片抠图到点/孤儿（契约章节 docs/specs/2026-09-18-image-cutout-mediakit.md / IKGXM2）：
     *  套 source 白名单（与 claim 同源，单源 image_cutout）。 */
    default List<Long> listDueImageCutoutJobIds(int limit, int maxAgeMinutes) {
        return listDueJobIdsByTypeAndSources("image_cutout",
                List.of("image_cutout"), limit, maxAgeMinutes);
    }

    /** 视频去字幕到点/孤儿（迁移契约 §17 / IKGZ81）：套 source 白名单（与 claim 同源，
     *  单源 video_subtitle_erase；轮询自投消息丢失时由本扫描兜底重投，复用视频骨架语义）。 */
    default List<Long> listDueVideoSubtitleEraseJobIds(int limit, int maxAgeMinutes) {
        return listDueJobIdsByTypeAndSources(
                VideoSubtitleEraseContract.TAG,
                List.of(VideoSubtitleEraseContract.SOURCE),
                limit, maxAgeMinutes);
    }

    /** 视频 HD 高清到点/孤儿（IKH3VF，父规格 IKH3VB）：套 source 白名单（与 claim 同源，
     *  单源 video_enhance；轮询自投消息丢失时由本扫描兜底重投，复用视频骨架语义）。 */
    default List<Long> listDueVideoEnhanceJobIds(int limit, int maxAgeMinutes) {
        return listDueJobIdsByTypeAndSources(
                VideoEnhanceContract.TAG,
                List.of(VideoEnhanceContract.SOURCE),
                limit, maxAgeMinutes);
    }

    /** 人声背景分离到点/孤儿（IKHA2J）：套 source 白名单（与 claim 同源，单源 vocal_split；
     *  轮询自投消息丢失时由本扫描兜底重投，复用视频骨架语义）。 */
    default List<Long> listDueVocalSplitJobIds(int limit, int maxAgeMinutes) {
        return listDueJobIdsByTypeAndSources(
                VocalSplitContract.TAG,
                List.of(VocalSplitContract.SOURCE),
                limit, maxAgeMinutes);
    }

    /** 视频场景切分到点/孤儿（IKH8BP，父规格 IKH86V）：套 source 白名单（与 claim 同源，
     *  单源 video_scene_split；轮询自投消息丢失时由本扫描兜底重投，复用视频骨架语义）。 */
    default List<Long> listDueVideoSceneSplitJobIds(int limit, int maxAgeMinutes) {
        return listDueJobIdsByTypeAndSources(
                com.bluewhale.worker.domain.contract.VideoSceneSplitContract.TAG,
                List.of(com.bluewhale.worker.domain.contract.VideoSceneSplitContract.SOURCE),
                limit, maxAgeMinutes);
    }

    /** 智能抠像到点/孤儿（IKHK99，父规格 IKHJRC，契约 IKHK7F）：套 source 白名单（与 claim
     *  同源，单源 video_matting；轮询自投消息丢失时由本扫描兜底重投，复用视频骨架语义）。 */
    default List<Long> listDueVideoMattingJobIds(int limit, int maxAgeMinutes) {
        return listDueJobIdsByTypeAndSources(
                com.bluewhale.worker.domain.contract.VideoMattingContract.TAG,
                List.of(com.bluewhale.worker.domain.contract.VideoMattingContract.SOURCE),
                limit, maxAgeMinutes);
    }

    /** 视频插帧到点/孤儿（IKHLKJ，父需求 IKHLES）：套 source 白名单（与 claim 同源，
     *  单源 video_frame_interpolation；轮询自投消息丢失时由本扫描兜底重投，复用视频骨架语义）。
     *  已取消（status='cancelled'）的任务不在扫描条件内，取消后不再被重投。 */
    default List<Long> listDueVideoFrameInterpolationJobIds(int limit, int maxAgeMinutes) {
        return listDueJobIdsByTypeAndSources(
                VideoFrameInterpolationContract.TAG,
                List.of(VideoFrameInterpolationContract.SOURCE),
                limit, maxAgeMinutes);
    }
}
