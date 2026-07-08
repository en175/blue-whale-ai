package com.bluewhale.agent.service;

import com.bluewhale.agent.common.exception.GlobalException;
import com.bluewhale.agent.common.resp.SystemCode;
import com.bluewhale.agent.mapper.AssetMapper;
import com.bluewhale.agent.mapper.GenerationJobMapper;
import com.bluewhale.agent.model.dto.CreateJobResponse;
import com.bluewhale.agent.model.dto.ImageGenerateRequest;
import com.bluewhale.agent.model.dto.ImageResult;
import com.bluewhale.agent.model.dto.JobStatusResponse;
import com.bluewhale.agent.model.dto.VideoGenerateRequest;
import com.bluewhale.agent.model.dto.VideoTaskResult;
import com.bluewhale.agent.model.entity.Asset;
import com.bluewhale.agent.model.entity.GenerationJob;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 生成任务服务：状态机 {@code queued → processing → succeeded | failed}（沿用 PRD §5.4）。
 *
 * <p>文生图同步：insert job → 调 Ark → 转存 asset → update succeeded。
 * 图文生视频异步：insert job(queued) → 调 Ark 创建任务 → update processing + providerTaskId + nextPollAt → 返 jobId。
 * poller 调 {@link #pollJob(GenerationJob)} 查 Ark 推进状态，succeeded 时下载转存。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GenerationJobService {

    /** poller 单任务最大轮询次数，超限判 upstream_timeout。 */
    public static final int MAX_POLL_COUNT = 120;
    private static final long POLL_INTERVAL_SECONDS = 5;

    private final GenerationJobMapper jobMapper;
    private final AssetMapper assetMapper;
    private final VolcEngineService volcEngineService;
    private final AssetStorageService assetStorageService;

    /** 文生图同步生成。 */
    @Transactional
    public ImageResult createImageJob(ImageGenerateRequest req, Long userId) {
        GenerationJob job = newGenerationJob(userId, GenerationJob.TYPE_IMAGE, buildImageInput(req));
        jobMapper.insert(job);
        try {
            String imageUrl = volcEngineService.generateImage(req.prompt(), mapImageSize(req.resolution()), false);
            Asset asset = assetStorageService.downloadAndStore(imageUrl, userId, Asset.TYPE_IMAGE, "image/png");
            job.setStatus(GenerationJob.STATUS_SUCCEEDED)
                    .setProgress(100)
                    .setOutputAssetIds(List.of(asset.getId()));
            jobMapper.updateById(job);
            return new ImageResult(asset.getId(), asset.getUrl());
        } catch (DataAccessException e) {
            markFailed(job, 500, "数据库未连接，请检查本地 MySQL");
            throw new GlobalException("数据库未连接，请检查本地 MySQL");
        } catch (Exception e) {
            markFailed(job, SystemCode.FAILURE_CODE, e.getMessage());
            throw e instanceof GlobalException ge ? ge : new GlobalException(SystemCode.FAILURE_CODE, e.getMessage());
        }
    }

    /** 图文生视频异步提交，立即返 jobId。 */
    @Transactional
    public CreateJobResponse createVideoJob(VideoGenerateRequest req, Long userId) {
        GenerationJob job = newGenerationJob(userId, GenerationJob.TYPE_VIDEO, buildVideoInput(req));
        jobMapper.insert(job);
        try {
            String taskId = volcEngineService.createVideoTask(req.prompt(), req.firstFrameUrl(),
                    req.aspectRatio(), req.resolution(), req.duration());
            job.setStatus(GenerationJob.STATUS_PROCESSING)
                    .setProviderTaskId(taskId)
                    .setPollCount(0)
                    .setNextPollAt(LocalDateTime.now().plusSeconds(POLL_INTERVAL_SECONDS))
                    .setProgress(0);
            jobMapper.updateById(job);
            return new CreateJobResponse(job.getId(), GenerationJob.STATUS_QUEUED);
        } catch (Exception e) {
            markFailed(job, SystemCode.FAILURE_CODE, e.getMessage());
            throw e instanceof GlobalException ge ? ge : new GlobalException(SystemCode.FAILURE_CODE, e.getMessage());
        }
    }

    /** 查询任务状态，供前端轮询。 */
    public JobStatusResponse getJobStatus(Long jobId) {
        GenerationJob job = jobMapper.selectById(jobId);
        if (job == null) {
            throw new GlobalException(SystemCode.NOT_FOUND_CODE, "job not found");
        }
        JobStatusResponse.AssetDto assetDto = null;
        if (GenerationJob.STATUS_SUCCEEDED.equals(job.getStatus())
                && job.getOutputAssetIds() != null && !job.getOutputAssetIds().isEmpty()) {
            Asset asset = assetMapper.selectById(job.getOutputAssetIds().get(0));
            if (asset != null) {
                assetDto = new JobStatusResponse.AssetDto(asset.getId(), asset.getUrl(), asset.getType());
            }
        }
        return new JobStatusResponse(job.getId(), job.getStatus(), job.getProgress(), assetDto);
    }

    /** poller 调：查 Ark 更新状态，succeeded 时下载转存视频。 */
    @Transactional
    public void pollJob(GenerationJob job) {
        if (!GenerationJob.STATUS_PROCESSING.equals(job.getStatus())) {
            return;
        }
        int pollCount = job.getPollCount() == null ? 0 : job.getPollCount();
        if (pollCount >= MAX_POLL_COUNT) {
            markFailed(job, SystemCode.UPSTREAM_TIMEOUT_CODE, "轮询次数超限（" + MAX_POLL_COUNT + "）");
            return;
        }
        VideoTaskResult result = volcEngineService.getVideoTask(job.getProviderTaskId());
        String status = mapStatus(result.status());
        int newPollCount = pollCount + 1;
        job.setPollCount(newPollCount);
        job.setLastPolledAt(LocalDateTime.now());
        job.setNextPollAt(LocalDateTime.now().plusSeconds(POLL_INTERVAL_SECONDS));
        switch (status) {
            case GenerationJob.STATUS_PROCESSING -> {
                job.setProgress(Math.min(90, newPollCount * 5));
                jobMapper.updateById(job);
            }
            case GenerationJob.STATUS_SUCCEEDED -> {
                if (result.videoUrl() == null) {
                    markFailed(job, SystemCode.ASSET_UNAVAILABLE_CODE, "succeeded 但无 video_url");
                    return;
                }
                Asset asset = assetStorageService.downloadAndStore(result.videoUrl(), job.getUserId(),
                        Asset.TYPE_VIDEO, "video/mp4");
                job.setStatus(GenerationJob.STATUS_SUCCEEDED)
                        .setProgress(100)
                        .setOutputAssetIds(List.of(asset.getId()));
                jobMapper.updateById(job);
                log.info("video job {} succeeded, assetId={}", job.getId(), asset.getId());
            }
            case GenerationJob.STATUS_FAILED -> markFailed(job, SystemCode.CONTENT_MODERATION_REJECTED_CODE,
                    result.errorMsg() != null ? result.errorMsg() : "上游任务失败");
            default -> jobMapper.updateById(job);
        }
    }

    private GenerationJob newGenerationJob(Long userId, String type, Map<String, Object> input) {
        return new GenerationJob()
                .setUserId(userId)
                .setType(type)
                .setSource(GenerationJob.SOURCE_DOCK)
                .setInput(input)
                .setStatus(GenerationJob.STATUS_QUEUED)
                .setProgress(0)
                .setProvider("volcengine");
    }

    private Map<String, Object> buildImageInput(ImageGenerateRequest req) {
        Map<String, Object> input = new HashMap<>();
        input.put("prompt", req.prompt());
        input.put("resolution", req.resolution());
        input.put("aspectRatio", req.aspectRatio());
        input.put("quantity", req.quantity());
        return input;
    }

    private Map<String, Object> buildVideoInput(VideoGenerateRequest req) {
        Map<String, Object> input = new HashMap<>();
        input.put("prompt", req.prompt());
        input.put("resolution", req.resolution());
        input.put("aspectRatio", req.aspectRatio());
        input.put("duration", req.duration());
        input.put("firstFrameUrl", req.firstFrameUrl());
        return input;
    }

    private void markFailed(GenerationJob job, int code, String message) {
        job.setStatus(GenerationJob.STATUS_FAILED);
        Map<String, Object> err = new HashMap<>();
        err.put("code", code);
        err.put("message", message == null ? "" : message);
        job.setError(err);
        jobMapper.updateById(job);
    }

    /** 前端 resolution 字符串 → 火山方舟 images 接口支持的 size。 */
    private String mapImageSize(String resolution) {
        if (resolution == null || resolution.isBlank()) {
            return "2K";
        }
        String lower = resolution.toLowerCase();
        // 像素格式（如 1024x1024）直接透传
        if (lower.matches("\\d+x\\d+")) {
            return resolution;
        }
        return switch (lower) {
            case "1k" -> "2K";
            case "2k" -> "2K";
            case "3k" -> "3K";
            case "4k" -> "4K";
            default -> "2K";
        };
    }

    /** 火山 status → 本地状态机。 */
    private String mapStatus(String upstream) {
        if (upstream == null) {
            return GenerationJob.STATUS_PROCESSING;
        }
        return switch (upstream.toLowerCase()) {
            case "succeeded" -> GenerationJob.STATUS_SUCCEEDED;
            case "failed", "cancelled", "expired" -> GenerationJob.STATUS_FAILED;
            default -> GenerationJob.STATUS_PROCESSING; // queued / running
        };
    }
}
