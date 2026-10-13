package com.bluewhale.worker.infrastructure.persistence.mapper;

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

@Mapper
public interface GenerationJobMapper extends BaseMapper<GenerationJobEntity> {

    @Select("""
            SELECT * FROM generation_jobs
            WHERE id = #{jobId}
              AND type = #{type}
              AND is_delete = false
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
    GenerationJobEntity findCandidateByTypeOnly(
            @Param("jobId") Long jobId,
            @Param("type") String type);

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
              AND (status = 'queued' OR lease_expires_at IS NULL OR lease_expires_at < NOW())
            """)
    int claimMediaExtractCas(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("leaseExpiresAt") LocalDateTime leaseExpiresAt,
            @Param("fencingToken") Long fencingToken,
            @Param("candidateStatus") String candidateStatus
    );

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

    @Update("""
            UPDATE generation_jobs
            SET lease_expires_at = #{leaseExpiresAt}, version = version + 1
            WHERE id = #{jobId} AND type = 'audio_mix' AND source = 'dock'
              AND status = 'processing' AND lease_owner = #{workerId}
              AND fencing_token = #{fencingToken} AND lease_expires_at > NOW()
            """)
    int renewAudioMixLease(@Param("jobId") Long jobId,
                           @Param("workerId") String workerId,
                           @Param("fencingToken") Long fencingToken,
                           @Param("leaseExpiresAt") LocalDateTime leaseExpiresAt);

    @Select("""
            SELECT id FROM generation_jobs
            WHERE id = #{jobId}
            FOR UPDATE NOWAIT
            """)
    Long probeJobRowWriteLock(@Param("jobId") Long jobId);

    @Update("""
            UPDATE generation_jobs
            SET lease_expires_at = #{leaseExpiresAt}, version = version + 1
            WHERE id = #{jobId} AND type = 'audio_video_mux' AND source = 'dock'
              AND status = 'processing' AND lease_owner = #{workerId}
              AND fencing_token = #{fencingToken} AND lease_expires_at > NOW()
            """)
    int renewAudioVideoMuxLease(@Param("jobId") Long jobId,
                                @Param("workerId") String workerId,
                                @Param("fencingToken") Long fencingToken,
                                @Param("leaseExpiresAt") LocalDateTime leaseExpiresAt);

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

    @Update("""
            UPDATE generation_jobs
            SET status = 'succeeded',
                progress = 100,
                next_action_at = NULL,
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

    @Update("""
            UPDATE generation_jobs
            SET output_asset_ids = #{outputAssetIdsJson}
            WHERE id = #{jobId}
            """)
    int updateOutputAssetIds(
            @Param("jobId") Long jobId,
            @Param("outputAssetIdsJson") String outputAssetIdsJson
    );

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
    int failMediaExtractGuard(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("fencingToken") Long fencingToken,
            @Param("errorJson") String errorJson
    );


    @Select("""
            SELECT * FROM generation_jobs
            WHERE id = #{jobId}
              AND type = 'audio'
              AND is_delete = false
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



    @Select("""
            <script>
            SELECT * FROM generation_jobs
            WHERE id = #{jobId}
              AND type = #{type}
              AND source IN
              <foreach collection="sources" item="item" open="(" separator="," close=")">#{item}</foreach>
              AND is_delete = false
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
              AND (status = 'queued' OR lease_expires_at IS NULL OR lease_expires_at < NOW())
            """)
    int claimImageCas(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("leaseExpiresAt") LocalDateTime leaseExpiresAt,
            @Param("fencingToken") Long fencingToken,
            @Param("candidateStatus") String candidateStatus
    );

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

    @Update("""
            UPDATE generation_jobs
            SET status = #{finalStatus}
            WHERE id = #{jobId}
            """)
    int updateJobStatus(@Param("jobId") Long jobId, @Param("finalStatus") String finalStatus);

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


    @Select("""
            SELECT * FROM generation_jobs
            WHERE id = #{jobId}
              AND type = 'video'
              AND source IN ('bottom_dock', 'plan_apply', 'plan', 'scene_card')
              AND is_delete = false
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

    @Update("""
            UPDATE generation_jobs
            SET status = 'checking',
                version = version + 1
            WHERE id = #{jobId}
              AND status = 'processing'
              AND lease_owner = #{workerId}
              AND fencing_token = #{fencingToken}
              AND provider_task_id IS NULL
            """)
    int markSubmissionAttempt(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("fencingToken") Long fencingToken
    );

    @Update("""
            UPDATE generation_jobs
            SET status = 'processing',
                provider = 'new-api',
                provider_task_id = #{providerTaskId},
                progress = 1,
                next_action_at = #{nextActionAt},
                lease_owner = NULL,
                lease_expires_at = NULL,
                version = version + 1
            WHERE id = #{jobId}
              AND (status = 'processing' OR status = 'checking')
              AND lease_owner = #{workerId}
              AND fencing_token = #{fencingToken}
            """)
    int markProviderSubmitted(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("fencingToken") Long fencingToken,
            @Param("providerTaskId") String providerTaskId,
            @Param("nextActionAt") java.time.LocalDateTime nextActionAt
    );

    @Update("""
            UPDATE generation_jobs
            SET lease_expires_at = #{leaseExpiresAt},
                version = version + 1
            WHERE id = #{jobId}
              AND status = 'processing'
              AND lease_owner = #{workerId}
              AND fencing_token = #{fencingToken}
              AND provider_task_id IS NULL
            """)
    int reserveParentReuseSubmit(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("fencingToken") Long fencingToken,
            @Param("leaseExpiresAt") LocalDateTime leaseExpiresAt
    );

    @Update("""
            UPDATE generation_jobs
            SET poll_count = COALESCE(poll_count, 0) + 1,
                progress = #{progress},
                last_polled_at = #{now},
                next_action_at = #{nextActionAt},
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
            @Param("nextActionAt") java.time.LocalDateTime nextActionAt
    );

    @Update("""
            UPDATE generation_jobs
            SET status = 'succeeded',
                progress = 100,
                next_action_at = NULL,
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

    @Update("""
            UPDATE generation_jobs
            SET status = 'failed',
                error = #{errorJson},
                next_action_at = NULL,
                lease_owner = NULL,
                lease_expires_at = NULL,
                version = version + 1
            WHERE id = #{jobId}
              AND (status = 'processing' OR status = 'checking')
              AND lease_owner = #{workerId}
              AND fencing_token = #{fencingToken}
            """)
    int failVideoGuard(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("fencingToken") Long fencingToken,
            @Param("errorJson") String errorJson
    );

    @Update("""
            UPDATE generation_jobs
            SET status = 'cancelled',
                progress = 0,
                next_action_at = NULL,
                lease_owner = NULL,
                lease_expires_at = NULL,
                version = version + 1
            WHERE id = #{jobId}
              AND status = 'processing'
              AND lease_owner = #{workerId}
              AND fencing_token = #{fencingToken}
              AND provider_task_id IS NULL
            """)
    int cancelJobBeforeDispatch(
            @Param("jobId") Long jobId,
            @Param("workerId") String workerId,
            @Param("fencingToken") Long fencingToken
    );

    @Update("""
            UPDATE generation_jobs
            SET status = 'cancelled',
                progress = 0,
                next_action_at = NULL,
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

    @Update("""
            UPDATE generation_jobs
            SET status = 'cancelled', progress = 0,
                next_action_at = NULL,
                lease_owner = NULL, lease_expires_at = NULL,
                version = version + 1
            WHERE id = #{jobId} AND type = 'audio_mix' AND source = 'dock'
              AND status = 'processing' AND lease_owner = #{workerId}
              AND fencing_token = #{fencingToken}
              AND cancel_requested_at IS NOT NULL
            """)
    int cancelAudioMixIfRequested(@Param("jobId") Long jobId,
                                  @Param("workerId") String workerId,
                                  @Param("fencingToken") Long fencingToken);

    @Update("""
            UPDATE generation_jobs
            SET status = 'cancelled', progress = 0,
                next_action_at = NULL,
                lease_owner = NULL, lease_expires_at = NULL,
                version = version + 1
            WHERE id = #{jobId} AND type = 'audio_video_mux' AND source = 'dock'
              AND status = 'processing' AND lease_owner = #{workerId}
              AND fencing_token = #{fencingToken}
              AND cancel_requested_at IS NOT NULL
            """)
    int cancelAudioVideoMuxIfRequested(@Param("jobId") Long jobId,
                                       @Param("workerId") String workerId,
                                       @Param("fencingToken") Long fencingToken);

    @Select("""
            SELECT provider_task_id FROM generation_jobs WHERE id = #{jobId}
            """)
    String findProviderTaskId(@Param("jobId") Long jobId);



    @Select("""
            <script>
            SELECT id FROM generation_jobs
            WHERE type = #{type}
            <if test="sources != null and !sources.isEmpty()">
              AND source IN
              <foreach collection="sources" item="item" open="(" separator="," close=")">#{item}</foreach>
            </if>
            AND is_delete = false
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
            @Param("limit") int limit);

    @Update("""
            UPDATE generation_jobs
            SET status = 'failed',
                error = #{errorJson},
                next_action_at = NULL,
                lease_owner = NULL,
                lease_expires_at = NULL,
                version = version + 1
            WHERE id = #{jobId}
              AND is_delete = false
              AND status IN ('queued', 'processing')
              AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
              AND execution_deadline_at IS NOT NULL
              AND execution_deadline_at < NOW()
            """)
    int expireJobGuard(@Param("jobId") Long jobId, @Param("errorJson") String errorJson);

    @Select("""
            SELECT id FROM generation_jobs
            WHERE is_delete = false
              AND status IN ('queued', 'processing')
              AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
              AND execution_deadline_at IS NOT NULL
              AND execution_deadline_at < NOW()
            ORDER BY id ASC
            LIMIT #{limit}
            """)
    List<Long> listExpiredJobIds(@Param("limit") int limit);

    @Select("""
            SELECT id, type FROM generation_jobs
            WHERE is_delete = false
              AND status = 'queued'
              AND cancel_requested_at IS NOT NULL
              AND next_action_at <= NOW()
            ORDER BY id ASC
            LIMIT #{limit}
            """)
    List<GenerationJobEntity> listCancelPendingJobs(@Param("limit") int limit);

    default List<Long> listDueVideoJobIds(int limit) {
        return listDueJobIdsByTypeAndSources("video",
                List.of("bottom_dock", "plan_apply", "plan", "scene_card"), limit);
    }

    default List<Long> listDueImageJobIds(int limit) {
        return listDueJobIdsByTypeAndSources("image",
                List.of("bottom_dock", "plan_apply", "storyboard_preview"), limit);
    }

    default List<Long> listDueAudioJobIds(int limit) {
        return listDueJobIdsByTypeAndSources("audio", List.of(), limit);
    }

    default List<Long> listDueMediaExtractJobIds(int limit) {
        return listDueJobIdsByTypeAndSources("media_extract", List.of(), limit);
    }

    default List<Long> listDueAudioTrimJobIds(int limit) {
        return listDueJobIdsByTypeAndSources("audio_trim", List.of(), limit);
    }

    default List<Long> listDueAudioMixJobIds(int limit) {
        return listDueJobIdsByTypeAndSources("audio_mix", List.of("dock"), limit);
    }

    default List<Long> listDueAudioVideoMuxJobIds(int limit) {
        return listDueJobIdsByTypeAndSources("audio_video_mux", List.of("dock"), limit);
    }

    default List<Long> listDueAudioSpeedJobIds(int limit) {
        return listDueJobIdsByTypeAndSources("audio_speed", List.of(), limit);
    }

    default List<Long> listDueImageEnhanceJobIds(int limit) {
        return listDueJobIdsByTypeAndSources("image_enhance",
                List.of("image_enhance"), limit);
    }

    default List<Long> listDueImageEraseJobIds(int limit) {
        return listDueJobIdsByTypeAndSources("image_erase",
                List.of("image_erase"), limit);
    }

    default List<Long> listDueImageOutpaintJobIds(int limit) {
        return listDueJobIdsByTypeAndSources("image_outpaint",
                List.of("image_outpaint"), limit);
    }

    default List<Long> listDueImageCutoutJobIds(int limit) {
        return listDueJobIdsByTypeAndSources("image_cutout",
                List.of("image_cutout"), limit);
    }

    default List<Long> listDueVideoSubtitleEraseJobIds(int limit) {
        return listDueJobIdsByTypeAndSources(
                VideoSubtitleEraseContract.TAG,
                List.of(VideoSubtitleEraseContract.SOURCE),
                limit);
    }

    default List<Long> listDueVideoEnhanceJobIds(int limit) {
        return listDueJobIdsByTypeAndSources(
                VideoEnhanceContract.TAG,
                List.of(VideoEnhanceContract.SOURCE),
                limit);
    }

    default List<Long> listDueVocalSplitJobIds(int limit) {
        return listDueJobIdsByTypeAndSources(
                VocalSplitContract.TAG,
                List.of(VocalSplitContract.SOURCE),
                limit);
    }

    default List<Long> listDueVideoSceneSplitJobIds(int limit) {
        return listDueJobIdsByTypeAndSources(
                com.bluewhale.worker.domain.contract.VideoSceneSplitContract.TAG,
                List.of(com.bluewhale.worker.domain.contract.VideoSceneSplitContract.SOURCE),
                limit);
    }

    default List<Long> listDueVideoMattingJobIds(int limit) {
        return listDueJobIdsByTypeAndSources(
                com.bluewhale.worker.domain.contract.VideoMattingContract.TAG,
                List.of(com.bluewhale.worker.domain.contract.VideoMattingContract.SOURCE),
                limit);
    }

    default List<Long> listDueVideoFrameInterpolationJobIds(int limit) {
        return listDueJobIdsByTypeAndSources(
                VideoFrameInterpolationContract.TAG,
                List.of(VideoFrameInterpolationContract.SOURCE),
                limit);
    }
}
